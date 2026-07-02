import os

html_content = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="description" content="Sistema de Cadastro Escolar - Horários">
    <title>Horários 2026 - CIEP Jaguari</title>

    <!-- Favicon -->
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎓</text></svg>">

    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

    <!-- CSS -->
    <link rel="stylesheet" href="../css/main.css">
    <link rel="stylesheet" href="../css/components.css">
    <link rel="stylesheet" href="../css/watermark.css">
    <link rel="stylesheet" href="horario-jaguari.css">

    <!-- Bootstrap Icons -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
</head>

<body>
    <div class="page">
        <!-- Navbar -->
        <nav class="navbar">
            <div class="navbar-content">
                <div class="navbar-brand">
                    <span class="logo"><i class="bi bi-calendar-week"></i></span>
                    <span>Sistema Escolar</span>
                </div>
                <div class="navbar-nav">
                    <a href="index.html" class="btn btn-ghost"><i class="bi bi-arrow-left"></i> Voltar</a>
                </div>
            </div>
        </nav>

        <main class="main-content">
            <section id="horario-jaguari" class="container">
                <div class="page-header">
                    <div>
                        <h1><i class="bi bi-calendar3"></i> Horários 2026</h1>
                        <p>CIEP Profª. Maria Nilde Mascellani — Jaguari &nbsp;|&nbsp; Referência: 25/02/2026</p>
                    </div>
                    <div class="header-actions">
                        <a href="../Horario Jaguari 2026/HORARIO_JAGUARI_2026_CONSOLIDADO.xlsx" download="HORARIO_JAGUARI_2026_CONSOLIDADO.xlsx" class="btn btn-outline">
                            <i class="bi bi-file-earmark-excel"></i> Baixar Horário Completo (Excel)
                        </a>
                    </div>
                </div>

                <div class="filtros-card card">
                    <div class="filtros-grid">
                        <div class="filtro-group">
                            <label><i class="bi bi-people"></i> Por Turma:</label>
                            <select id="sel-turma" class="form-input" onchange="mostrarTabela(this.value, 'turma')">
                                <option value="">Selecione a turma...</option>
                                <option value="1A">1º Ano A</option>
                                <option value="1B">1º Ano B</option>
                                <option value="1C">1º Ano C</option>
                                <option value="2A">2º Ano A</option>
                                <option value="2B">2º Ano B</option>
                                <option value="2C">2º Ano C</option>
                                <option value="3A">3º Ano A</option>
                                <option value="3B">3º Ano B</option>
                                <option value="3C">3º Ano C</option>
                                <option value="4A">4º Ano A</option>
                                <option value="4B">4º Ano B</option>
                                <option value="4C">4º Ano C</option>
                                <option value="5A">5º Ano A</option>
                                <option value="5B">5º Ano B</option>
                                <option value="5C">5º Ano C</option>
                                <option value="5D">5º Ano D</option>
                            </select>
                        </div>
                        <div class="filtro-divider">ou</div>
                        <div class="filtro-group">
                            <label><i class="bi bi-person-badge"></i> Por Professor:</label>
                            <select id="sel-prof" class="form-input" onchange="mostrarTabela(this.value, 'prof')">
                                <option value="">Selecione o professor...</option>
                                <option value="EDILENE">Edilene (P.A. Aux. Dir.)</option>
                                <option value="MARCOS">Marcos (Ed. Física)</option>
                                <option value="MARJORIE">Marjorie (Ed. Física)</option>
                                <option value="MIRIAN">Mirian (Artes)</option>
                                <option value="BIANCA">Bianca (Artes 1º Ano)</option>
                                <option value="MARCELO">Marcelo (Inglês)</option>
                                <option value="RAQUEL">Raquel Castelaneli (Of. Leitura)</option>
                                <option value="SIRLENE">Sirlene (Of. Maker)</option>
                                <option value="CHERLANE">Cherlane (Of. Sebrae)</option>
                                <option value="MARCIA">Marcia Caldeira (P.A.)</option>
                                <option value="DIRCEU">Dirceu (P.A.)</option>
                                <option value="LOURDES">Lourdes (P.A.)</option>
                                <option value="PIPOCA">Raquel Pipoca (P.A.)</option>
                            </select>
                        </div>
                        <div class="filtro-group" style="display: flex; align-items: flex-end;">
                            <button class="btn btn-primary w-100" onclick="mostrarTabela('GERAL', 'geral')">
                                <i class="bi bi-table"></i> Visão Geral
                            </button>
                        </div>
                    </div>
                </div>

                <div id="tabelas-container">
                    <div id="tabela-placeholder" class="empty-state">
                        <i class="bi bi-search"></i>
                        <h3>Selecione uma opção</h3>
                        <p>Escolha uma turma, professor ou visão geral para ver os horários</p>
                    </div>
                </div>
            </section>
        </main>
    </div>

    <script src="horario-jaguari.js"></script>
</body>
</html>
"""

with open(r"c:\Users\Usuario1\Downloads\sistema-escolar-v2-main (2)\sistema-escolar-v2-main\direcao\horario-jaguari.html", "w", encoding="utf-8") as f:
    f.write(html_content)
