#!/bin/bash
set -e

echo "🚀 Building Raw Agent Desktop for macOS M1..."

# 0. 检查前置条件
if [ ! -f "package.json" ]; then
  echo "❌ 请从仓库根目录运行此脚本"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo "❌ 找不到 node，请先安装 Node.js >= 22"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "❌ Node.js 版本过低（当前 $(node -v)），需要 >= 22"
  exit 1
fi

# 1. Generate icons
echo ""
echo "🎨 Step 1/6: Generating icons..."
bash scripts/generate-icons.sh || echo "⚠️  Icon generation skipped (optional)"

# 2. 安装根依赖
echo ""
echo "📦 Step 2/6: Installing dependencies..."
npm install

# 3. Build core packages and daemon
echo ""
echo "🔨 Step 3/6: Building core packages and daemon..."
npm run build

# 4. Build web console in standalone mode
echo ""
echo "🌐 Step 4/6: Building web console (standalone)..."
cd apps/web-console
npm run build
cd ../..

# 5. Prepare server bundle
echo ""
echo "📦 Step 5/6: Preparing server bundle..."
node scripts/prepare-desktop-server.mjs

# 6. Install desktop dependencies and build
echo ""
echo "🖥️  Step 6/6: Building desktop application..."
cd apps/desktop
npm install
npm run dist

echo ""
echo "✅ Build complete!"
echo ""
echo "📍 Output location: apps/desktop/release/"
echo ""
ls -lh apps/desktop/release/*.dmg 2>/dev/null || echo "⚠️  DMG file not found, check release folder"
echo ""
echo "🎉 You can now distribute the .dmg file to users!"
