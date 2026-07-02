import math
import random
from PIL import Image, ImageDraw

def generate_voice_wave_rgb_v2(output_path):
    width, height = 300, 300
    center_x, center_y = width // 2, height // 2
    frames = []
    
    # Bright RGB Gradient colors
    colors = [
        (255, 0, 128),  # Rose
        (160, 32, 240), # Purple
        (0, 0, 255),    # Pure Blue
        (0, 255, 255),  # Cyan
        (0, 255, 0),    # Lime
        (255, 255, 0),  # Yellow
        (255, 165, 0)   # Orange
    ]

    for frame_idx in range(20):
        # transparent background
        img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        num_lines = 80
        for i in range(num_lines):
            angle = (i / num_lines) * 2 * math.pi
            
            # Animation pattern: combination of sine waves for organic movement
            phase = frame_idx * 0.4
            length_factor = 0.5 + 0.5 * math.sin(phase + i * 0.15)
            length = 20 + 50 * length_factor + random.uniform(0, 10)
            
            # Draw the line (risco)
            inner_radius = 60
            outer_radius = inner_radius + length
            
            x1 = center_x + inner_radius * math.cos(angle)
            y1 = center_y + inner_radius * math.sin(angle)
            x2 = center_x + outer_radius * math.cos(angle)
            y2 = center_y + outer_radius * math.sin(angle)
            
            # Color interpolation
            color_progress = (i / num_lines) * (len(colors) - 1)
            idx = int(color_progress)
            t = color_progress - idx
            
            c1 = colors[idx]
            c2 = colors[idx+1]
            
            r = int(c1[0] * (1-t) + c2[0] * t)
            g = int(c1[1] * (1-t) + c2[1] * t)
            b = int(c1[2] * (1-t) + c2[2] * t)
            
            # Draw line with rounded-like appearance (width 3)
            draw.line([(x1, y1), (x2, y2)], fill=(r, g, b, 255), width=3)
            
            # Add a subtle glow point at the end of the line
            draw.ellipse([x2-2, y2-2, x2+2, y2+2], fill=(r, g, b, 200))
        
        frames.append(img)
    
    # Save as GIF with transparency support
    frames[0].save(
        output_path, 
        save_all=True, 
        append_images=frames[1:], 
        duration=50, 
        loop=0, 
        disposal=2 # Important for clearing previous frame in transparent GIFs
    )
    print(f"Animation saved to {output_path}")

if __name__ == "__main__":
    generate_voice_wave_rgb_v2("c:/Users/Usuario1/Downloads/sistema-escolar-v2-main (8)/sistema-escolar-v2-main/img/voice_wave_rgb.gif")
