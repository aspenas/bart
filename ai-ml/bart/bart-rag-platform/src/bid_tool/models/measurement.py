"""
Measurement models for BART bid tool.
Maps to Excel sheets: Ext Measure, Int Measure, Cabinet Measure, Gutter, WW, Holiday Measure
"""

from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import Column, Integer, String, DateTime, Boolean, JSON, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from .project import Base


class Measurement(Base):
    """Base measurement entity for all types of measurements"""
    __tablename__ = "measurements"
    
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    measurement_type = Column(String(50), nullable=False)  # exterior, interior, cabinet, etc.
    
    # Common fields across all measurement types
    area_name = Column(String(200))  # e.g., "Front Elevation", "Master Bedroom"
    notes = Column(Text)
    photo_urls = Column(JSON)  # List of photo URLs
    voice_note_url = Column(String(500))
    
    # Geolocation for validation
    latitude = Column(Float)
    longitude = Column(Float)
    
    # Measurement data - stored as JSON to handle different types flexibly
    # This preserves all the Excel cell data
    measurement_data = Column(JSON, nullable=False)
    
    # Calculated fields (from hidden Excel sheets)
    calculated_sqft = Column(Float)
    calculated_labor_hours = Column(Float)
    calculated_material_cost = Column(Float)
    calculated_labor_cost = Column(Float)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(String(100))  # User who took measurement
    
    # Relationship
    project = relationship("Project", back_populates="measurements")
    
    def __repr__(self):
        return f"<Measurement {self.measurement_type}: {self.area_name}>"


class ExteriorMeasurement(Base):
    """Specific fields for exterior measurements"""
    __tablename__ = "exterior_measurements"
    
    id = Column(Integer, primary_key=True)
    measurement_id = Column(Integer, ForeignKey("measurements.id"), nullable=False)
    
    # Siding details
    siding_type = Column(String(100))  # vinyl, cedar, stucco, brick, etc.
    elevation_count = Column(Integer)
    stories = Column(Integer)
    
    # Surface measurements
    body_sqft = Column(Float)
    trim_linear_ft = Column(Float)
    soffit_sqft = Column(Float)
    soffit_size = Column(String(10))  # 12", 24", 36"
    
    # Special features
    shutters_count = Column(Integer)
    garage_doors_count = Column(Integer)
    entry_doors_count = Column(Integer)
    
    # Paint details
    body_colors_count = Column(Integer)
    trim_colors_count = Column(Integer)
    accent_colors_count = Column(Integer)
    
    # Condition assessments
    requires_pressure_wash = Column(Boolean, default=True)
    requires_scraping = Column(Boolean, default=False)
    requires_priming = Column(Boolean, default=False)
    wood_replacement_needed = Column(Boolean, default=False)
    
    measurement = relationship("Measurement", backref="exterior_details")


class InteriorMeasurement(Base):
    """Specific fields for interior measurements"""
    __tablename__ = "interior_measurements"
    
    id = Column(Integer, primary_key=True)
    measurement_id = Column(Integer, ForeignKey("measurements.id"), nullable=False)
    
    # Room details
    room_name = Column(String(100))
    room_type = Column(String(50))  # bedroom, bathroom, kitchen, etc.
    
    # Surface measurements
    wall_sqft = Column(Float)
    ceiling_sqft = Column(Float)
    trim_linear_ft = Column(Float)
    doors_count = Column(Integer)
    windows_count = Column(Integer)
    
    # Paint scope
    paint_walls = Column(Boolean, default=True)
    paint_ceiling = Column(Boolean, default=True)
    paint_trim = Column(Boolean, default=True)
    paint_doors = Column(Boolean, default=True)
    
    # Wall texture
    texture_type = Column(String(50))  # smooth, orange peel, knockdown, etc.
    
    # Special requirements
    furniture_moving_required = Column(Boolean, default=False)
    wallpaper_removal = Column(Boolean, default=False)
    drywall_repair_level = Column(String(20))  # none, minor, moderate, major
    
    measurement = relationship("Measurement", backref="interior_details")


class CabinetMeasurement(Base):
    """Specific fields for cabinet measurements"""
    __tablename__ = "cabinet_measurements"
    
    id = Column(Integer, primary_key=True)
    measurement_id = Column(Integer, ForeignKey("measurements.id"), nullable=False)
    
    # Cabinet details
    upper_cabinets_count = Column(Integer)
    lower_cabinets_count = Column(Integer)
    drawer_fronts_count = Column(Integer)
    
    # Door measurements
    door_sqft_total = Column(Float)
    box_linear_ft = Column(Float)
    
    # Finish details
    current_finish = Column(String(50))  # stained, painted, laminate
    desired_finish = Column(String(50))
    requires_stripping = Column(Boolean, default=False)
    requires_sanding = Column(Boolean, default=True)
    
    measurement = relationship("Measurement", backref="cabinet_details")