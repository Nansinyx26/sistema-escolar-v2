import json
import os
from datetime import datetime

def generate_bi_insights():
    """
    Analisa dados pedagógicos fictícios baseados na estrutura do sistema
    e gera um arquivo JSON de insights inteligentes.
    Em um cenário real, este script se conectaria ao MongoDB.
    """
    
    # Simulação de análise de dados
    insights = {
        "generated_at": datetime.now().isoformat(),
        "summary": {
            "total_students": 1250,
            "overall_avg": 7.4,
            "attendance_rate": "88.5%",
            "risk_students": 42
        },
        "trends": [
            {
                "label": "Evolução Acadêmica 2026",
                "data": [7.1, 7.2, 7.4, 7.5, 7.3, 7.6, 7.8],
                "labels": ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul"]
            }
        ],
        "smart_insights": [
            {
                "type": "positive",
                "title": "Evolução em Matemática",
                "content": "A turma 8A apresentou crescimento de 15% na média de Matemática após implementação do reforço digital."
            },
            {
                "type": "warning",
                "title": "Alerta de Frequência",
                "content": "Queda de 5% na frequência geral na última quinzena. Sugerimos verificar engajamento no 3º Bimestre."
            },
            {
                "type": "critical",
                "title": "Desempenho em Física",
                "content": "Média global de Física está em 5.4. Identificado gap de aprendizado em Mecânica na Turma 2º B."
            }
        ],
        "risk_analysis": {
            "critical_subjects": ["Física", "Química"],
            "top_performing_classes": ["9A", "3º Ensino Médio"],
            "prediction": "Tendência de estabilidade nas notas para o próximo bimestre com base nos dados atuais."
        }
    }

    # Garante que o diretório de dados existe
    data_dir = os.path.join(os.getcwd(), 'data')
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)

    output_path = os.path.join(data_dir, 'bi_insights.json')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(insights, f, indent=4, ensure_ascii=False)
    
    print(f"✅ BI Insights gerados com sucesso em: {output_path}")

if __name__ == "__main__":
    generate_bi_insights()
