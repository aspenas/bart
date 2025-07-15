"""
Project models for BART bid tool.
Maps to Excel sheets: Client info Page, New Client Info Page
"""

from datetime import datetime
from typing import Optional, Dict, Any, List
from sqlalchemy import Column, Integer, String, DateTime, Boolean, JSON, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


class Project(Base):
    """Main project/bid entity"""
    __tablename__ = "projects"
    
    id = Column(Integer, primary_key=True)
    project_number = Column(String(50), unique=True, nullable=False)
    
    # Client Information (from Client info Page)
    client_name = Column(String(200), nullable=False)
    client_phone = Column(String(20))
    client_email = Column(String(100))
    client_address = Column(String(500))
    city = Column(String(100))
    state = Column(String(2))
    zip_code = Column(String(10))
    
    # Project Details
    project_type = Column(String(50))  # exterior, interior, cabinet, gutter, holiday
    lead_source = Column(String(100))
    sales_rep = Column(String(100))
    
    # Important Flags
    lead_paint_year = Column(Integer)  # Year built for lead paint check
    hoa_approval_needed = Column(Boolean, default=False)
    vinyl_positive = Column(Boolean, default=False)
    
    # Status
    status = Column(String(50), default="draft")  # draft, estimated, approved, in_progress, completed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    measurements = relationship("Measurement", back_populates="project", cascade="all, delete-orphan")
    calculations = relationship("Calculation", back_populates="project", cascade="all, delete-orphan")
    crew_assignments = relationship("CrewAssignment", back_populates="project", cascade="all, delete-orphan")
    checklists = relationship("Checklist", back_populates="project", cascade="all, delete-orphan")
    
    # Cached totals from calculations
    estimated_total = Column(Float)
    estimated_labor = Column(Float)
    estimated_materials = Column(Float)
    margin_amount = Column(Float)
    
    # Salesforce sync
    salesforce_id = Column(String(50))
    salesforce_sync_status = Column(String(50))
    salesforce_last_sync = Column(DateTime)
    
    def __repr__(self):
        return f"<Project {self.project_number}: {self.client_name}>"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses"""
        return {
            "id": self.id,
            "project_number": self.project_number,
            "client_name": self.client_name,
            "client_phone": self.client_phone,
            "client_email": self.client_email,
            "address": {
                "street": self.client_address,
                "city": self.city,
                "state": self.state,
                "zip": self.zip_code
            },
            "project_type": self.project_type,
            "lead_paint_risk": self.lead_paint_year and self.lead_paint_year < 1978,
            "status": self.status,
            "totals": {
                "estimated_total": self.estimated_total,
                "labor": self.estimated_labor,
                "materials": self.estimated_materials,
                "margin": self.margin_amount
            },
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }