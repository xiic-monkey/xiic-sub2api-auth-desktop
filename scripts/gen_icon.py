#!/usr/bin/env python3
"""生成 app 图标源图 (1024x1024)。
蓝色圆角方块 + 白色钥匙符号（授权语义）。纯几何、无版权。
依赖：Pillow。
"""
from PIL import Image, ImageDraw

W = 1024
img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 背景：蓝色圆角方块
d.rounded_rectangle([0, 0, W - 1, W - 1], radius=232, fill=(37, 99, 235, 255))

white = (255, 255, 255, 255)
lw = 66
cx, cy = W // 2, W // 2
hr = 132
hx = cx - 160
hy = cy

# 钥匙头：圆环
d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], outline=white, width=lw)

# 钥匙柄：向右
shaft = 330
sx = hx + int(hr * 0.55)
d.rectangle([sx, cy - lw // 2, sx + shaft, cy + lw // 2], fill=white)

# 钥匙齿：末端向下两道
bx = sx + shaft
d.rectangle([bx - 6, cy + lw // 2, bx + 34, cy + lw // 2 + 78], fill=white)
d.rectangle([bx - 56, cy + lw // 2, bx - 16, cy + lw // 2 + 54], fill=white)

img.save("src-tauri/app-icon.png")
print("saved", img.size)
