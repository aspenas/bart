"""
Project API endpoints for BART bid tool.
Handles project creation, updates, and bid calculations.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from datetime import datetime
import json

from ...api.dependencies import get_db
from ..models.project import Project
from ..models.measurement import Measurement, ExteriorMeasurement, InteriorMeasurement
from ..models.calculation import Calculation
from ..services.formula_engine import BARTCalculationEngine, ExcelFormulaEngine
from ..services.excel_importer import BARTExcelImporter

router = APIRouter(prefix="/api/v1/bid-tool/projects", tags=["bid-tool-projects"])

# Initialize calculation engine
formula_engine = ExcelFormulaEngine()
calc_engine = BARTCalculationEngine(formula_engine)


@router.post("/", response_model=dict)
async def create_project(
    project_data: dict,
    db: Session = Depends(get_db)
) -> dict:
    """
    Create a new project/bid.
    Mobile-optimized endpoint for field employees.
    """
    
    # Create project
    project = Project(
        project_number=f"BART-{datetime.now().strftime('%Y%m%d-%H%M%S')}",
        client_name=project_data["client_name"],
        client_phone=project_data.get("client_phone"),
        client_email=project_data.get("client_email"),
        client_address=project_data.get("client_address"),
        city=project_data.get("city"),
        state=project_data.get("state"),
        zip_code=project_data.get("zip_code"),
        project_type=project_data["project_type"],
        lead_paint_year=project_data.get("lead_paint_year"),
        sales_rep=project_data.get("sales_rep", "Mobile User")
    )
    
    # Check lead paint risk
    if project.lead_paint_year and project.lead_paint_year < 1978:
        project.notes = "⚠️ LEAD PAINT RISK - Property built before 1978. EPA RRP rules apply."
    
    db.add(project)
    db.commit()
    db.refresh(project)
    
    return project.to_dict()


@router.get("/{project_id}", response_model=dict)
async def get_project(
    project_id: int,
    db: Session = Depends(get_db)
) -> dict:
    """Get project details with all measurements and calculations"""
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all related data
    result = project.to_dict()
    
    # Add measurements
    measurements = db.query(Measurement).filter(
        Measurement.project_id == project_id
    ).all()
    
    result["measurements"] = [
        {
            "id": m.id,
            "type": m.measurement_type,
            "area_name": m.area_name,
            "data": m.measurement_data,
            "calculated_sqft": m.calculated_sqft,
            "photos": m.photo_urls
        }
        for m in measurements
    ]
    
    # Add latest calculation
    latest_calc = db.query(Calculation).filter(
        Calculation.project_id == project_id
    ).order_by(Calculation.created_at.desc()).first()
    
    if latest_calc:
        result["calculation"] = {
            "total": latest_calc.total_amount,
            "labor": latest_calc.base_labor_cost,
            "materials": latest_calc.base_material_cost,
            "margin": latest_calc.margin_tier1_amount + latest_calc.margin_tier2_amount,
            "breakdown": latest_calc.component_costs
        }
    
    return result


@router.post("/{project_id}/measurements", response_model=dict)
async def add_measurement(
    project_id: int,
    measurement_data: dict,
    photos: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db)
) -> dict:
    """
    Add measurement to project.
    Supports photo upload and voice notes.
    """
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Create base measurement
    measurement = Measurement(
        project_id=project_id,
        measurement_type=measurement_data["type"],
        area_name=measurement_data["area_name"],
        measurement_data=measurement_data["data"],
        notes=measurement_data.get("notes"),
        latitude=measurement_data.get("latitude"),
        longitude=measurement_data.get("longitude"),
        created_by=measurement_data.get("created_by", "Mobile User")
    )
    
    # Handle photo uploads
    if photos:
        photo_urls = []
        for photo in photos:
            # In production, upload to S3
            # For now, just store filename
            photo_urls.append(photo.filename)
        measurement.photo_urls = photo_urls
    
    db.add(measurement)
    db.flush()  # Get ID without committing
    
    # Add type-specific details
    if measurement_data["type"] == "exterior":
        exterior = ExteriorMeasurement(
            measurement_id=measurement.id,
            siding_type=measurement_data["data"].get("siding_type"),
            body_sqft=measurement_data["data"].get("body_sqft", 0),
            trim_linear_ft=measurement_data["data"].get("trim_linear_ft", 0),
            requires_pressure_wash=measurement_data["data"].get("requires_pressure_wash", True)
        )
        db.add(exterior)
    
    db.commit()
    db.refresh(measurement)
    
    return {
        "id": measurement.id,
        "type": measurement.measurement_type,
        "area_name": measurement.area_name,
        "created_at": measurement.created_at.isoformat()
    }


@router.post("/{project_id}/calculate", response_model=dict)
async def calculate_bid(
    project_id: int,
    options: Optional[dict] = None,
    db: Session = Depends(get_db)
) -> dict:
    """
    Calculate bid for project using Excel formula engine.
    Returns detailed breakdown matching Excel calculations.
    """
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all measurements
    measurements = db.query(Measurement).filter(
        Measurement.project_id == project_id
    ).all()
    
    if not measurements:
        raise HTTPException(status_code=400, detail="No measurements found")
    
    # Prepare calculation based on project type
    if project.project_type == "exterior":
        # Aggregate exterior measurements
        total_body_sqft = 0
        total_trim_ft = 0
        
        for m in measurements:
            if m.measurement_type == "exterior":
                data = m.measurement_data
                total_body_sqft += data.get("body_sqft", 0)
                total_trim_ft += data.get("trim_linear_ft", 0)
        
        # Calculate using formula engine
        calculation_input = {
            "body_sqft": total_body_sqft,
            "trim_linear_ft": total_trim_ft,
            "vinyl_positive": project.vinyl_positive,
            "margin1": options.get("margin1", 0.25) if options else 0.25,
            "margin2": options.get("margin2", 0.15) if options else 0.15
        }
        
        result = calc_engine.calculate_exterior_bid(calculation_input)
        
    else:
        # Handle other project types
        result = {"error": "Calculation not implemented for this project type"}
    
    # Save calculation
    calc = Calculation(
        project_id=project_id,
        calculation_type="bid",
        input_data=calculation_input,
        base_material_cost=result["calculations"]["material_cost"],
        base_labor_cost=result["calculations"]["labor_cost"],
        margin_tier1_percent=calculation_input["margin1"],
        margin_tier2_percent=calculation_input["margin2"],
        subtotal=result["calculations"]["subtotal"],
        total_amount=result["calculations"]["total"],
        component_costs=result["breakdown"]
    )
    
    db.add(calc)
    
    # Update project totals
    project.estimated_total = calc.total_amount
    project.estimated_labor = calc.base_labor_cost
    project.estimated_materials = calc.base_material_cost
    project.estimated_margin = calc.total_amount - calc.subtotal
    
    db.commit()
    
    return result


@router.get("/{project_id}/checklist/{checklist_type}", response_model=dict)
async def get_checklist(
    project_id: int,
    checklist_type: str,
    db: Session = Depends(get_db)
) -> dict:
    """
    Get checklist for project phase.
    Types: initial_walk, exterior, interior, warranty
    """
    
    # Load checklist from Excel data
    checklists = {
        "initial_walk": [
            {"task": "Call, leave voicemail, text, log call", "completed": False},
            {"task": "Confirm client availability", "completed": False},
            {"task": "Introduction - Smile, give business card", "completed": False},
            {"task": "Walk property with homeowner", "completed": False},
            {"task": "Take photos of all surfaces", "completed": False},
            {"task": "Discuss color preferences", "completed": False},
            {"task": "Check for lead paint (pre-1978)", "completed": False},
            {"task": "Note special requirements", "completed": False}
        ],
        "exterior": [
            {"task": "Protect landscaping", "completed": False},
            {"task": "Pressure wash surfaces", "completed": False},
            {"task": "Scrape loose paint", "completed": False},
            {"task": "Prime bare wood", "completed": False},
            {"task": "Caulk gaps and cracks", "completed": False},
            {"task": "Apply first coat", "completed": False},
            {"task": "Apply second coat", "completed": False},
            {"task": "Clean up daily", "completed": False}
        ]
    }
    
    return {
        "project_id": project_id,
        "checklist_type": checklist_type,
        "items": checklists.get(checklist_type, [])
    }


@router.post("/{project_id}/generate-pdf", response_model=dict)
async def generate_pdf_estimate(
    project_id: int,
    db: Session = Depends(get_db)
) -> dict:
    """Generate PDF estimate for customer"""
    
    # In production, generate actual PDF
    # For now, return URL placeholder
    
    return {
        "project_id": project_id,
        "pdf_url": f"/estimates/BART-{project_id}.pdf",
        "generated_at": datetime.now().isoformat()
    }


@router.post("/import-excel", response_model=dict)
async def import_excel_data(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
) -> dict:
    """
    Import data and formulas from BART Excel file.
    One-time setup endpoint.
    """
    
    # Save uploaded file temporarily
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    # Import Excel data
    importer = BARTExcelImporter(tmp_path)
    import_data = importer.import_all()
    
    # Load lookup tables into formula engine
    formula_engine.load_lookup_tables(import_data['lookups'])
    
    # Store formulas
    for formula_key, formula_data in import_data['formulas'].items():
        # Convert and store each formula
        python_code = formula_engine.convert_formula_to_python(formula_data['formula'])
        formula_engine.formulas[formula_key] = python_code
    
    return {
        "status": "success",
        "sheets_imported": len(import_data['data']),
        "formulas_converted": len(import_data['formulas']),
        "lookups_loaded": len(import_data['lookups']),
        "metadata": import_data['metadata']
    }