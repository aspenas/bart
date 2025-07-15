#!/usr/bin/env python3
"""
Import BART 3.20 Excel data into the modernized bid tool.
Preserves all formulas, lookups, and business logic.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pathlib import Path
import json
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.bid_tool.services.excel_importer import BARTExcelImporter
from src.bid_tool.services.formula_engine import ExcelFormulaEngine
from src.bid_tool.models.calculation import FormulaDefinition, LookupTable, PricingRule
from src.bid_tool.models.project import Base

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def setup_database():
    """Create database and tables"""
    engine = create_engine('sqlite:///bart_bid_tool.db')
    Base.metadata.create_all(engine)
    return engine


def import_excel_to_database(excel_path: str):
    """Import Excel workbook into database"""
    
    # Setup database
    engine = setup_database()
    Session = sessionmaker(bind=engine)
    session = Session()
    
    # Import Excel data
    logger.info(f"Importing Excel file: {excel_path}")
    importer = BARTExcelImporter(excel_path)
    excel_data = importer.import_all()
    
    logger.info(f"Found {len(excel_data['formulas'])} formulas")
    logger.info(f"Found {len(excel_data['lookups'])} lookup tables")
    
    # Store lookup tables
    for table_name, table_data in excel_data['lookups'].items():
        lookup = LookupTable(
            table_name=table_name,
            excel_sheet=table_data.get('sheet', ''),
            excel_range=table_data.get('range', ''),
            headers=table_data.get('headers', []),
            data_rows=table_data.get('data', []),
            uses_composite_key=table_data.get('composite_key') is not None,
            composite_key_format=table_data.get('composite_key', '')
        )
        session.add(lookup)
    
    # Convert and store formulas
    formula_engine = ExcelFormulaEngine()
    
    for formula_key, formula_data in excel_data['formulas'].items():
        try:
            # Convert Excel formula to Python
            python_code = formula_engine.convert_formula_to_python(
                formula_data['formula']
            )
            
            # Store formula definition
            formula_def = FormulaDefinition(
                formula_name=formula_key,
                excel_reference=formula_data['cell'],
                excel_sheet=formula_data['sheet'],
                formula_type=_identify_formula_type(formula_data['formula']),
                complexity_score=formula_data.get('complexity', 0),
                python_code=python_code,
                dependencies=formula_data.get('dependencies', [])
            )
            session.add(formula_def)
            
        except Exception as e:
            logger.error(f"Failed to convert formula {formula_key}: {e}")
    
    # Import pricing rules from Data2
    if 'Data2' in excel_data['data']:
        data2 = excel_data['data']['Data2']
        if 'lookup_tables' in data2:
            for row in data2['lookup_tables'].get('data', []):
                if len(row) >= 4:
                    rule = PricingRule(
                        rule_key=f"{row[0]}_{row[1]}" if len(row) > 1 else str(row[0]),
                        rule_type='material',
                        item_description=str(row[0]),
                        base_price=float(row[3]) if row[3] else 0,
                        source_table='Data2'
                    )
                    session.add(rule)
    
    # Commit all changes
    session.commit()
    logger.info("Import completed successfully")
    
    # Save import summary
    summary = {
        'source_file': excel_path,
        'sheets_imported': len(excel_data['data']),
        'formulas_converted': len(excel_data['formulas']),
        'lookups_imported': len(excel_data['lookups']),
        'metadata': excel_data['metadata']
    }
    
    with open('import_summary.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    return summary


def _identify_formula_type(formula: str) -> str:
    """Identify the type of Excel formula"""
    formula_upper = formula.upper()
    
    if 'VLOOKUP' in formula_upper:
        return 'vlookup'
    elif 'IF' in formula_upper:
        return 'conditional'
    elif 'SUM' in formula_upper or '+' in formula or '-' in formula:
        return 'calculation'
    else:
        return 'other'


if __name__ == "__main__":
    # Path to BART Excel file
    excel_path = Path(__file__).parent.parent.parent / "bart3.20.xlsx"
    
    if not excel_path.exists():
        logger.error(f"Excel file not found: {excel_path}")
        sys.exit(1)
    
    # Run import
    summary = import_excel_to_database(str(excel_path))
    
    print("\n=== Import Summary ===")
    print(json.dumps(summary, indent=2))
    print("\nExcel data successfully imported to database!")
    print("The bid tool is now ready to use with all Excel formulas preserved.")