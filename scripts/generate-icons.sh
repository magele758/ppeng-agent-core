#!/bin/bash
# Generate icon assets from SVG

cd "$(dirname "$0")/../apps/desktop/assets"

# Check if iconutil is available (macOS only)
if ! command -v iconutil &> /dev/null; then
    echo "iconutil not found. Icons will be generated during build if needed."
    echo "For manual generation on macOS, install Xcode Command Line Tools."
    exit 0
fi

# Check if sips is available
if ! command -v sips &> /dev/null; then
    echo "sips not found. Cannot generate icons."
    exit 1
fi

# Create temporary iconset directory
ICONSET_DIR="icon.iconset"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

# Generate PNG files at different sizes
echo "Generating PNG files from SVG..."
sizes=(16 32 64 128 256 512 1024)

for size in "${sizes[@]}"; do
    # Regular resolution
    sips -s format png -z $size $size icon.svg --out "$ICONSET_DIR/icon_${size}x${size}.png" > /dev/null 2>&1
    
    # Retina resolution (2x) - skip 1024 as it would be 2048
    if [ $size -lt 1024 ]; then
        double=$((size * 2))
        sips -s format png -z $double $double icon.svg --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" > /dev/null 2>&1
    fi
done

# Generate .icns file
echo "Creating .icns file..."
iconutil -c icns "$ICONSET_DIR" -o icon.icns

# Create tray icon (16x16 template)
echo "Creating tray icon..."
sips -s format png -z 16 16 icon.svg --out trayTemplate.png > /dev/null 2>&1
sips -s format png -z 32 32 icon.svg --out trayTemplate@2x.png > /dev/null 2>&1

# Clean up
rm -rf "$ICONSET_DIR"

echo "✅ Icons generated successfully!"
ls -lh *.icns *.png
