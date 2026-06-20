#!/usr/bin/env python3
import os
import sys
from PIL import Image, ImageDraw

def process_identity_dark(src_path, dest_dir):
    print(f"Processing dark identity mark from {src_path}...")
    img = Image.open(src_path)
    # Ensure RGB
    if img.mode != "RGB":
        img = img.convert("RGB")
    
    # Save the different sizes
    sizes = [
        ("mark-512x512.png", (512, 512)),
        ("mark-192x192.png", (192, 192)),
        ("mark-96x96.png", (96, 96))
    ]
    
    for filename, size in sizes:
        out_path = os.path.join(dest_dir, filename)
        resized = img.resize(size, Image.Resampling.LANCZOS)
        resized.save(out_path)
        print(f"Saved {out_path} ({size[0]}x{size[1]})")

def process_identity_light(src_path, dest_dir):
    print(f"Processing light identity mark from {src_path}...")
    img = Image.open(src_path)
    if img.mode != "RGB":
        img = img.convert("RGB")
    
    width, height = img.size
    
    # Bounding box crop for the leaf to exclude text at the bottom.
    # Background color is off-white (#FDFCFC). Let's define background threshold.
    bg_threshold = 240
    
    # Find first row with non-background pixels (leaf top)
    leaf_top = 0
    for y in range(height):
        is_bg_row = True
        for x in range(0, width, 5): # sample every 5th pixel for speed
            r, g, b = img.getpixel((x, y))
            if r < bg_threshold or g < bg_threshold or b < bg_threshold:
                is_bg_row = False
                break
        if not is_bg_row:
            leaf_top = y
            break
            
    # Find the gap between leaf and text.
    # We scan down from leaf_top. We look for a block of rows that are purely background.
    leaf_bottom = height - 1
    in_leaf = True
    gap_count = 0
    for y in range(leaf_top, height):
        is_bg_row = True
        for x in range(0, width, 5):
            r, g, b = img.getpixel((x, y))
            if r < bg_threshold or g < bg_threshold or b < bg_threshold:
                is_bg_row = False
                break
        
        if is_bg_row:
            if in_leaf:
                gap_count += 1
                if gap_count > 15: # 15 consecutive background rows marks the gap
                    leaf_bottom = y - gap_count
                    break
        else:
            gap_count = 0
            
    # Crop the leaf region vertically
    leaf_img_y = img.crop((0, leaf_top, width, leaf_bottom))
    
    # Find horizontal bounds of the leaf in the cropped region
    w_crop, h_crop = leaf_img_y.size
    leaf_left = 0
    for x in range(w_crop):
        is_bg_col = True
        for y in range(h_crop):
            r, g, b = leaf_img_y.getpixel((x, y))
            if r < bg_threshold or g < bg_threshold or b < bg_threshold:
                is_bg_col = False
                break
        if not is_bg_col:
            leaf_left = x
            break
            
    leaf_right = w_crop - 1
    for x in range(w_crop - 1, -1, -1):
        is_bg_col = True
        for y in range(h_crop):
            r, g, b = leaf_img_y.getpixel((x, y))
            if r < bg_threshold or g < bg_threshold or b < bg_threshold:
                is_bg_col = False
                break
        if not is_bg_col:
            leaf_right = x
            break
            
    # Crop leaf fully
    leaf_final = leaf_img_y.crop((leaf_left, 0, leaf_right, h_crop))
    lf_w, lf_h = leaf_final.size
    
    # Center on a new square canvas with #FDFCFC background
    margin = int(max(lf_w, lf_h) * 0.15)
    canvas_size = max(lf_w, lf_h) + margin * 2
    canvas = Image.new("RGB", (canvas_size, canvas_size), (253, 252, 252)) # #FDFCFC
    
    # Paste centered
    paste_x = (canvas_size - lf_w) // 2
    paste_y = (canvas_size - lf_h) // 2
    canvas.paste(leaf_final, (paste_x, paste_y))
    
    # Save light mark
    out_path = os.path.join(dest_dir, "mark-512x512-light.png")
    resized = canvas.resize((512, 512), Image.Resampling.LANCZOS)
    resized.save(out_path)
    print(f"Saved {out_path} (512x512)")

def process_app_icon(src_path, dest_icon_path, dest_dock_path):
    print(f"Processing app icon from {src_path}...")
    img = Image.open(src_path)
    if img.mode != "RGB":
        img = img.convert("RGB")
        
    width, height = img.size
    
    # Bounding box detection for the squircle (find dark pixels on light checkerboard)
    left = 0
    for x in range(width // 2):
        r, g, b = img.getpixel((x, height // 2))
        if r < 120 and g < 120 and b < 120:
            left = x
            break
            
    right = width - 1
    for x in range(width - 1, width // 2, -1):
        r, g, b = img.getpixel((x, height // 2))
        if r < 120 and g < 120 and b < 120:
            right = x
            break
            
    top = 0
    for y in range(height // 2):
        r, g, b = img.getpixel((width // 2, y))
        if r < 120 and g < 120 and b < 120:
            top = y
            break
            
    bottom = height - 1
    for y in range(height - 1, height // 2, -1):
        r, g, b = img.getpixel((width // 2, y))
        if r < 120 and g < 120 and b < 120:
            bottom = y
            break
            
    # Center & size
    cx = (left + right) // 2
    cy = (top + bottom) // 2
    sz = min(right - left, bottom - top)
    
    x0 = cx - sz // 2
    y0 = cy - sz // 2
    x1 = x0 + sz
    y1 = y0 + sz
    
    # Crop squircle
    cropped = img.crop((x0, y0, x1, y1))
    
    # Create mask for squircle (rounded rectangle)
    # macOS squircle radius is about 22% of size
    radius = int(sz * 0.22)
    
    mask = Image.new("L", (sz, sz), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, sz, sz], radius=radius, fill=255)
    
    # Make transparent RGBA image
    rgba_cropped = cropped.convert("RGBA")
    rgba_cropped.putalpha(mask)
    
    # Add a bit of padding around the squircle (standard macOS app icon has a bit of margins)
    padding = int(sz * 0.08)
    final_sz = sz + padding * 2
    final_img = Image.new("RGBA", (final_sz, final_sz), (0, 0, 0, 0))
    final_img.paste(rgba_cropped, (padding, padding))
    
    # Resize and save
    dock_resized = final_img.resize((512, 512), Image.Resampling.LANCZOS)
    dock_resized.save(dest_dock_path)
    print(f"Saved {dest_dock_path} (512x512)")
    
    icon_resized = final_img.resize((192, 192), Image.Resampling.LANCZOS)
    icon_resized.save(dest_icon_path)
    print(f"Saved {dest_icon_path} (192x192)")

def main():
    base_dir = "/Users/user/.gemini/antigravity-ide/brain/05afb9f8-87e4-4573-97d8-556f2f017c80"
    src_dir = os.path.join(base_dir, "scratch/source_images")
    
    # Identity Mark Targets
    identity_dir = "/Users/user/Developer/GitHub/Tribunus/packages/identity"
    process_identity_dark(os.path.join(src_dir, "mark_dark.png"), identity_dir)
    process_identity_light(os.path.join(src_dir, "mark_light.png"), identity_dir)
    
    # Channel Targets
    channels = ["dev", "beta", "prod"]
    for ch in channels:
        ch_dir = f"/Users/user/Developer/GitHub/Tribunus/packages/desktop/icons/{ch}"
        os.makedirs(ch_dir, exist_ok=True)
        src_path = os.path.join(src_dir, f"app_{ch}.png")
        dest_icon = os.path.join(ch_dir, "icon.png")
        dest_dock = os.path.join(ch_dir, "dock.png")
        process_app_icon(src_path, dest_icon, dest_dock)
        
    print("\nIcon processing completed successfully!")

if __name__ == "__main__":
    main()
