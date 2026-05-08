import re
import sys

filepath = r'g:\マイドライブ\liquidblock-estimator\src\App.tsx'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# ===== Bulk color replacements =====
replacements = [
    # White text -> dark text
    ("color: '#fff'", "color: 'var(--text-primary)'"),
    ('color: "#fff"', 'color: "var(--text-primary)"'),
    ("color: '#e4e4e7'", "color: 'var(--text-primary)'"),
    
    # Dark semi-transparent backgrounds -> light equivalents
    ("background: 'rgba(255,255,255,0.05)'", "background: 'var(--bg-section)'"),
    ("background: 'rgba(255,255,255,0.04)'", "background: 'var(--bg-section)'"),
    ("background: 'rgba(255,255,255,0.03)'", "background: 'var(--bg-section)'"),
    ("background: 'rgba(255,255,255,0.02)'", "background: 'var(--bg-section)'"),
    ("background: 'rgba(255,255,255,0.1)'", "background: 'var(--border-light)'"),
    ("background: 'rgba(0,0,0,0.5)'", "background: 'var(--bg-section)'"),
    ("background: 'rgba(0,0,0,0.3)'", "background: 'var(--bg-section)'"),
    ("background: 'rgba(0,0,0,0.2)'", "background: 'var(--bg-section)'"),
    ("background: 'rgba(0,0,0,0.75)'", "background: 'rgba(0,0,0,0.5)'"),
    
    # Neon cyan references -> brand red
    ("color: 'var(--neon-cyan)'", "color: 'var(--brand-red)'"),
    ("borderColor: 'var(--neon-cyan)'", "borderColor: 'var(--brand-red)'"),
    ("background: 'var(--neon-cyan)'", "background: 'var(--brand-red)'"),
    ("background: 'var(--neon-cyan-glow)'", "background: 'var(--brand-red-light)'"),
    ("color=\"var(--neon-cyan)\"", "color=\"var(--brand-red)\""),
    
    # Neon pink -> danger red
    ("color: 'var(--neon-pink)'", "color: 'var(--color-danger)'"),
    ("borderColor: 'var(--neon-pink)'", "borderColor: 'var(--color-danger)'"),
    ("color=\"var(--neon-pink)\"", "color=\"var(--color-danger)\""),
    
    # Neon green -> success green (keep)
    ("color: 'var(--neon-green)'", "color: 'var(--color-success)'"),
    ("background: 'var(--neon-green)'", "background: 'var(--color-success)'"),
    ("color=\"var(--neon-green)\"", "color=\"var(--color-success)\""),
    
    # Neon purple -> brand purple  
    ("color: 'var(--neon-purple)'", "color: '#7C3AED'"),
    ("color=\"var(--neon-purple)\"", "color=\"#7C3AED\""),
    
    # CG partial / checkbox accent colors
    ("accentColor: 'var(--neon-cyan)'", "accentColor: 'var(--brand-red)'"),
    ("accentColor: 'var(--neon-purple)'", "accentColor: '#7C3AED'"),
    
    # Cyan-themed rgba backgrounds -> red-themed
    ("background: 'rgba(6, 182, 212, 0.08)'", "background: 'rgba(208, 2, 27, 0.06)'"),
    ("background: 'rgba(6, 182, 212, 0.12)'", "background: 'rgba(208, 2, 27, 0.08)'"),
    ("background: 'rgba(6, 182, 212, 0.1)'", "background: 'rgba(208, 2, 27, 0.06)'"),
    ("background: 'rgba(6, 182, 212, 0.05)'", "background: 'rgba(208, 2, 27, 0.04)'"),
    ("background: 'rgba(6, 182, 212, 0.04)'", "background: 'rgba(208, 2, 27, 0.04)'"),
    ("background: 'rgba(6, 182, 212, 0.03)'", "background: 'rgba(208, 2, 27, 0.03)'"),
    ("border: '1px solid rgba(6, 182, 212, 0.3)'", "border: '1px solid rgba(208, 2, 27, 0.2)'"),
    ("border: '1px solid rgba(6, 182, 212, 0.25)'", "border: '1px solid rgba(208, 2, 27, 0.15)'"),
    ("border: '1px solid rgba(6, 182, 212, 0.2)'", "border: '1px solid rgba(208, 2, 27, 0.15)'"),
    ("border: '1px solid rgba(6, 182, 212, 0.15)'", "border: '1px solid rgba(208, 2, 27, 0.1)'"),
    
    # Pink-themed rgba -> red-themed for errors
    ("background: 'rgba(236, 72, 153, 0.15)'", "background: 'rgba(239, 68, 68, 0.08)'"),
    ("background: 'rgba(236, 72, 153, 0.1)'", "background: 'rgba(239, 68, 68, 0.06)'"),
    ("background: 'rgba(236, 72, 153, 0.08)'", "background: 'rgba(239, 68, 68, 0.06)'"),
    ("border: '1px solid rgba(236, 72, 153, 0.3)'", "border: '1px solid rgba(239, 68, 68, 0.2)'"),
    ("border: '1px solid rgba(236, 72, 153, 0.25)'", "border: '1px solid rgba(239, 68, 68, 0.15)'"),
    
    # Purple-themed rgba -> subtle purple
    ("background: 'rgba(139, 92, 246, 0.12)'", "background: 'rgba(124, 58, 237, 0.08)'"),
    ("background: 'rgba(139, 92, 246, 0.1)'", "background: 'rgba(124, 58, 237, 0.06)'"),
    ("background: 'rgba(139, 92, 246, 0.08)'", "background: 'rgba(124, 58, 237, 0.06)'"),
    ("background: 'rgba(139, 92, 246, 0.06)'", "background: 'rgba(124, 58, 237, 0.04)'"),
    ("background: 'rgba(139,92,246,0.1)'", "background: 'rgba(124, 58, 237, 0.06)'"),
    ("border: '1px solid rgba(139, 92, 246, 0.3)'", "border: '1px solid rgba(124, 58, 237, 0.2)'"),
    ("border: '1px solid rgba(139, 92, 246, 0.2)'", "border: '1px solid rgba(124, 58, 237, 0.15)'"),
    
    # Green-themed rgba (keep similar)
    ("background: 'rgba(16, 185, 129, 0.15)'", "background: 'rgba(16, 185, 129, 0.08)'"),
    ("background: 'rgba(16, 185, 129, 0.1)'", "background: 'rgba(16, 185, 129, 0.06)'"),
    ("background: 'rgba(16, 185, 129, 0.08)'", "background: 'rgba(16, 185, 129, 0.06)'"),
    ("border: '1px solid rgba(16, 185, 129, 0.3)'", "border: '1px solid rgba(16, 185, 129, 0.2)'"),
    ("border: '1px solid rgba(16,185,129,0.3)'", "border: '1px solid rgba(16, 185, 129, 0.2)'"),
    
    # Background #111 in select option
    ("background: '#111'", "background: '#fff'"),
    
    # Color #000 on icons
    ("color=\"#000\"", "color=\"#fff\""),
    ("color: '#000'", "color: '#fff'"),
    
    # Gradient backgrounds -> solid
    ("background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(6,182,212,0.08))'", 
     "background: 'rgba(124, 58, 237, 0.04)'"),
    ("background: 'linear-gradient(90deg, var(--neon-cyan), var(--neon-purple))'",
     "background: 'var(--brand-red)'"),
    
    # Border-subtle adjustments
    ("borderBottom: '1px solid var(--border-subtle)'", "borderBottom: '1px solid var(--border-color)'"),
    ("borderTop: '1px solid var(--border-subtle)'", "borderTop: '1px solid var(--border-color)'"),
    ("borderLeft: '4px solid var(--neon-cyan)'", "borderLeft: '4px solid var(--brand-red)'"),
    ("borderLeft: '4px solid var(--neon-pink)'", "borderLeft: '4px solid var(--color-danger)'"),
    ("borderLeft: '4px solid var(--neon-green)'", "borderLeft: '4px solid var(--color-success)'"),
    
    # Admin panel hover
    ("e.currentTarget.style.background = 'rgba(255,255,255,0.03)'", 
     "e.currentTarget.style.background = 'var(--bg-section)'"),
    
    # Input border-radius
    ("borderRadius: '4px'", "borderRadius: '0'"),
    ("borderRadius: '6px'", "borderRadius: '0'"),
    ("borderRadius: '8px'", "borderRadius: '2px'"),
    ("borderRadius: '10px'", "borderRadius: '2px'"),
    ("borderRadius: '12px'", "borderRadius: '2px'"),
    ("borderRadius: '16px'", "borderRadius: '2px'"),
    ("borderRadius: '20px'", "borderRadius: '2px'"),
    ("borderRadius: '100px'", "borderRadius: '0'"),
    ("borderRadius: '50%'", "borderRadius: '50%'"),  # Keep circles
    
    # Table backgrounds
    ("background: 'rgba(255,255,255,0.03)', borderRadius: '12px'", 
     "background: 'var(--bg-main)', borderRadius: '2px'"),
    
    # Dashed border
    ("border: '1px dashed var(--border-focus)'", "border: '1px dashed var(--border-color)'"),
    
    # backdrop-filter on modals (keep for modals but use lighter)
    ("backdropFilter: 'blur(8px)'", "backdropFilter: 'blur(4px)'"),
]

for old, new in replacements:
    content = content.replace(old, new)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. Applied {len(replacements)} replacement rules.")
