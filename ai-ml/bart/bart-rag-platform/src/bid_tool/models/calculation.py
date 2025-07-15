"""
Calculation models for BART bid tool.
Maps to hidden Excel formula sheets and preserves all business logic.
"""

from datetime import datetime
from typing import Optional, Dict, Any, List
from sqlalchemy import Column, Integer, String, DateTime, Boolean, JSON, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from .project import Base


class Calculation(Base):
    """Stores all calculated values from Excel formulas"""
    __tablename__ = "calculations"
    
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    
    # Calculation metadata
    calculation_type = Column(String(50))  # pricing, labor, materials, etc.
    formula_version = Column(String(20), default="3.20")  # Track Excel version
    
    # Raw calculation inputs (preserve Excel cell references)
    input_data = Column(JSON)  # All input values used
    
    # Calculation results
    base_labor_cost = Column(Float)
    base_material_cost = Column(Float)
    
    # Margin calculations (2-tier system from Excel)
    margin_tier1_percent = Column(Float)
    margin_tier1_amount = Column(Float)
    margin_tier2_percent = Column(Float)  
    margin_tier2_amount = Column(Float)
    
    # Final calculations
    subtotal = Column(Float)
    tax_amount = Column(Float)
    total_amount = Column(Float)
    
    # Component breakdowns
    component_costs = Column(JSON)  # Detailed breakdown by component
    
    # Audit trail
    formula_trace = Column(JSON)  # Step-by-step calculation trace
    excel_references = Column(JSON)  # Original Excel cell references
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    project = relationship("Project", back_populates="calculations")
    pricing_rules = relationship("PricingRule", back_populates="calculation")


class PricingRule(Base):
    """Stores pricing rules from Data2 and hidden pricing tables"""
    __tablename__ = "pricing_rules"
    
    id = Column(Integer, primary_key=True)
    calculation_id = Column(Integer, ForeignKey("calculations.id"))
    
    # Rule identification
    rule_key = Column(String(200), nullable=False)  # Composite key from Excel
    rule_type = Column(String(50))  # material, labor, overhead, etc.
    
    # Rule data
    item_description = Column(String(500))
    unit_of_measure = Column(String(50))
    base_price = Column(Float)
    crew_pay_rate = Column(Float)
    
    # Modifiers
    auto_increase_percent = Column(Float)
    manual_increase_amount = Column(Float)
    
    # Lookup table reference
    source_table = Column(String(100))  # Which Excel sheet/table
    source_row = Column(Integer)  # Original row number
    
    # Active date ranges
    effective_date = Column(DateTime)
    expiration_date = Column(DateTime)
    
    calculation = relationship("Calculation", back_populates="pricing_rules")


class FormulaDefinition(Base):
    """Stores converted Excel formulas as executable code"""
    __tablename__ = "formula_definitions"
    
    id = Column(Integer, primary_key=True)
    
    # Formula identification
    formula_name = Column(String(200), unique=True)
    excel_reference = Column(String(100))  # Original cell reference
    excel_sheet = Column(String(100))  # Source sheet
    
    # Formula details
    formula_type = Column(String(50))  # vlookup, calculation, conditional, etc.
    complexity_score = Column(Integer)  # From Excel analysis
    
    # Converted formula
    python_code = Column(Text)  # Python equivalent
    dependencies = Column(JSON)  # List of other formulas this depends on
    
    # Validation
    test_cases = Column(JSON)  # Input/output test cases
    last_validated = Column(DateTime)
    
    # Usage tracking
    usage_count = Column(Integer, default=0)
    average_execution_time_ms = Column(Float)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class LookupTable(Base):
    """Stores all VLOOKUP data from Excel"""
    __tablename__ = "lookup_tables"
    
    id = Column(Integer, primary_key=True)
    
    # Table identification
    table_name = Column(String(100), unique=True)
    excel_range = Column(String(50))  # e.g., "$R$16:$T$25"
    excel_sheet = Column(String(100))
    
    # Table data
    headers = Column(JSON)  # Column headers
    data_rows = Column(JSON)  # All table data
    
    # Lookup configuration
    key_column = Column(Integer)  # Which column is the lookup key
    value_columns = Column(JSON)  # Which columns contain values
    
    # Composite key support
    uses_composite_key = Column(Boolean, default=False)
    composite_key_format = Column(String(200))  # e.g., "{col1} {col2} {col3}"
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)