import os

filepath = r'c:\Users\Usuario1\Downloads\sistema-escolar-v2-main (12)\sistema-escolar-v2-main\.github\workflows\ci-cd.yml'
with open(filepath, 'rb') as f:
    content = f.read()

lines = content.splitlines()
with open('lines.txt', 'w', encoding='utf-8') as f_out:
    for idx in range(8, 25):
        if idx < len(lines):
            f_out.write(f"Line {idx+1}: {lines[idx].decode('utf-8')}\n")
print("WRITTEN")
