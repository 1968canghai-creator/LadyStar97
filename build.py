# 把 src/ 里的模板和三个 JS 文件合成单文件 index.html，并内嵌原版底部按钮图（../Ladystar97/buttons.bin）
import base64, pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
buttons = (root.parent / 'Ladystar97' / 'buttons.bin').read_bytes()
html = (src / 'index.template.html').read_text(encoding='utf-8')
html = html.replace('__BUTTONS_B64__', base64.b64encode(buttons).decode())
for tag, name in (('__Z80_JS__', 'z80.js'), ('__BOARD_JS__', 'board.js'), ('__APP_JS__', 'app.js')):
    js = (src / name).read_text(encoding='utf-8').replace('</script', '<\\/script')
    html = html.replace(tag, '\n' + js + '\n')
(root / 'index.html').write_text(html, encoding='utf-8')
print('index.html', len(html), 'bytes')
