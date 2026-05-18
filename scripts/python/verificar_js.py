import json
import re

with open('direcao/horario-jaguari.js', encoding='utf-8') as f:
    content = f.read()

# Extract JSON between "const turmasData = " and the first ";"
m = re.search(r'const turmasData = (\{.*?\});\s*\nfunction', content, re.DOTALL)
if not m:
    print("ERRO: nao encontrou o JSON")
    exit(1)

data = json.loads(m.group(1))

def print_turma(key):
    t = data.get(key, {})
    print("=== " + key + " ===")
    print("TURMA: " + str(t.get('turma')))
    print("PROF:  " + str(t.get('prof')))
    for h in t.get('horarios', []):
        if 'aulas' in h:
            aulas_str = ' | '.join(h['aulas'])
            hora = h['hora'][:22]
            print("  " + hora.ljust(22) + " | " + aulas_str)
        else:
            hora = h['hora'][:22]
            print("  " + hora.ljust(22) + " | [" + h['nome'] + "]")
    print()

print_turma('1A')
print_turma('2A')
print_turma('MARCOS')
