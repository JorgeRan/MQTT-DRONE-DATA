from PIL import Image
import os

# Open the original icon
original = Image.open('build/icon_original.png')

# Resize to 512x512 with high-quality resampling
resized = original.resize((512, 512), Image.Resampling.LANCZOS)

# Save with optimization
resized.save('build/icon.png', 'PNG', optimize=False)
print(f"Icon created: {resized.size}")
