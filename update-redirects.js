const fs = require('fs');
const path = require('path');

const directory = '.';
const filesToUpdate = [
    'js/app.js', 'js/auth.js', 'js/auth-module.js', 'js/perfil.js', 'js/dashboard.js',
    'js/selecionar.js', 'js/meus-dados.js', 'js/frequencia-professores.js', 'js/cadastro-professor.js',
    'js/cadastro-diretor.js', 'js/gerenciar-salas.js', 'js/lista-professores.js', 'js/escolher-perfil.js',
    'js/ata.js', 'direcao/direcao.js', 'direcao/direcao-notificacoes.js', 'detalhes/turmas.js',
    'detalhes/avaliacoes.js', 'utils/limpar-dados.html', 'reset-password.html', 'primeiro-acesso.html',
    'politica-privacidade.html', 'mudar-senha.html', 'admin/usuarios.html', 'admin/configuracoes.html',
    'js/events/login-events.js'
];

filesToUpdate.forEach(file => {
    const filePath = path.join(directory, file);
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Substituir redirecionamentos estritos
        content = content.replace(/window\.location\.href\s*=\s*['"]\/?index\.html['"]/g, "window.location.href = 'login.html'");
        content = content.replace(/window\.location\.href\s*=\s*['"]\.\.\/index\.html['"]/g, "window.location.href = '../login.html'");
        content = content.replace(/location\.href\s*=\s*['"]\/?index\.html['"]/g, "location.href = 'login.html'");
        
        // Substituir hrefs HTML (exato)
        content = content.replace(/href=['"]\/?index\.html\??.*?['"]/g, match => {
            return match.replace('index.html', 'login.html');
        });

        // Caso específico app.js 
        if (file === 'js/app.js') {
            content = content.replace(/filename === 'index\.html'/g, "filename === 'login.html'");
            content = content.replace(/\|\| 'index\.html'/g, "|| 'login.html'");
        }
        
        // Caso specifico login-events.js
        if(file === 'js/events/login-events.js') {
             content = content.replace(/index\.html \(tela de login\)/g, "login.html (tela de login)");
        }

        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Updated: ' + file);
    } else {
        console.log('Not found: ' + file);
    }
});
