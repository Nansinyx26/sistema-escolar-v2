import re
import os

path = r'c:\Users\Usuario1\Downloads\sistema-escolar-v2-main (2)\sistema-escolar-v2-main\direcao\horario-jaguari.js'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Novos slots para adicionar
new_slots = """            {
                "hora": "14h40–15h",
                "tipo": "intervalo",
                "nome": "INTERVALO / SAÍDA"
            },
            {
                "hora": "15h–16h",
                "aulas": ["REUNIÃO PEDAGÓGICA", "REUNIÃO PEDAGÓGICA", "REUNIÃO PEDAGÓGICA", "REUNIÃO PEDAGÓGICA", "REUNIÃO PEDAGÓGICA"]
            },
            {
                "hora": "16h–17h",
                "aulas": ["—", "—", "—", "—", "—"]
            },
            {
                "hora": "17h–18h",
                "aulas": ["—", "—", "—", "—", "—"]
            }"""

# Encontrar o final da lista de horários de cada turma. 
# O padrão é o objeto que termina com a hora 13h50...
# Vamos usar um padrão que capture o fechamento do objeto anterior e o fechamento da lista.

# Regex para encontrar o bloco de horários que termina em 13h50–14h40
# E injetar os novos slots antes de fechar o array "horarios"
pattern = r'(\{\s*"hora":\s*"13h50[^"]*",\s*"aulas":\s*\[[^\]]*\]\s*\})(\s*\])'

def replacement(match):
    return match.group(1) + ",\n" + new_slots + match.group(2)

new_content = re.sub(pattern, replacement, content)

if new_content != content:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Sucesso: Horários injetados em todas as turmas.")
else:
    print("Aviso: Nenhuma correspondência encontrada. Verifique se o arquivo já está atualizado ou se o formato mudou.")
