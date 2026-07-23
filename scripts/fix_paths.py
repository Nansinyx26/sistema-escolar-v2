import os
import re

subdirs = ["admin", "detalhes", "direcao", "pages", "utils"]
base_path = r"c:\Users\Usuario1\Downloads\sistema-escolar-v2-main (8)\sistema-escolar-v2-main\html"

# Pattern to match src="..." or href="..." starting with ../js/, ../css/, etc.
# Group 1: opening quote
# Group 2: the directory name
pattern = re.compile(r'([\'"])\.\./(js/|css/|favicon/|img/|direcao/|detalhes/|admin/|pages/)')

for subdir in subdirs:
    dir_path = os.path.join(base_path, subdir)
    if not os.path.exists(dir_path):
        continue
    
    for filename in os.listdir(dir_path):
        if filename.endswith(".html"):
            file_path = os.path.join(dir_path, filename)
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            new_content = pattern.sub(r'\1../../\2', content)
            
            if content != new_content:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print(f"Fixed paths in: {subdir}/{filename}")

print("Path fix completed.")
