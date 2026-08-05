/**
 * threejs-dashboard.js — Constelação de partículas 3D no fundo do Dashboard
 * Usa Three.js r134 (carregado via vendor.js)
 *
 * Efeito: 700 pontos flutuantes + linhas de conexão entre partículas próximas,
 * criando um efeito de constelação/rede neural que gira lentamente.
 * Cores: paleta azul/índigo alinhada com o tema escuro do sistema.
 */
(function () {
    'use strict';

    function waitForThree(cb) {
        if (window.THREE) { cb(); }
        else { setTimeout(function () { waitForThree(cb); }, 80); }
    }

    function init() {
        const THREE = window.THREE;

        // ── Canvas: posicionado fixo atrás de tudo ────────────────────────
        const canvas = document.createElement('canvas');
        canvas.id = 'three-bg-canvas';
        canvas.style.cssText = [
            'position:fixed',
            'inset:0',
            'width:100%',
            'height:100%',
            'z-index:-1',
            'pointer-events:none',
            'opacity:0',
            'transition:opacity 1.2s ease',
        ].join(';');
        
        const bgContainer = document.querySelector('.dashboard-bg') || document.body;
        if (bgContainer === document.body) {
            document.body.insertBefore(canvas, document.body.firstChild);
        } else {
            bgContainer.appendChild(canvas);
        }

        // Fade in suave após montar
        requestAnimationFrame(function () {
            canvas.style.opacity = '0.55';
        });

        // ── Renderer ──────────────────────────────────────────────────────
        const renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            alpha: true,
            antialias: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x000000, 0);

        // ── Cena e câmera ─────────────────────────────────────────────────
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            2000
        );
        camera.position.z = 500;

        // ── Partículas ────────────────────────────────────────────────────
        const PARTICLE_COUNT = 700;
        const SPREAD = 900;

        const positions = new Float32Array(PARTICLE_COUNT * 3);
        const velocities = []; // { vx, vy, vz }

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const i3 = i * 3;
            positions[i3]     = (Math.random() - 0.5) * SPREAD;
            positions[i3 + 1] = (Math.random() - 0.5) * SPREAD;
            positions[i3 + 2] = (Math.random() - 0.5) * SPREAD;

            velocities.push({
                vx: (Math.random() - 0.5) * 0.12,
                vy: (Math.random() - 0.5) * 0.12,
                vz: (Math.random() - 0.5) * 0.05,
            });
        }

        const particleGeo = new THREE.BufferGeometry();
        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const particleMat = new THREE.PointsMaterial({
            color: 0x6366f1,
            size: 2.2,
            transparent: true,
            opacity: 0.75,
            sizeAttenuation: true,
        });

        const particles = new THREE.Points(particleGeo, particleMat);
        scene.add(particles);

        // ── Linhas de conexão (constelação) ───────────────────────────────
        const MAX_DISTANCE = 120;
        const MAX_LINES    = 600; // limite de performance

        const linePositions = new Float32Array(MAX_LINES * 6); // 2 pontos × 3 coords
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

        // Não usaremos LineSegmentsGeometry, apenas LineBasicMaterial
        const lineMat = new THREE.LineBasicMaterial({
            color: 0x6366f1,
            transparent: true,
            opacity: 0.18,
        });

        const lineSegments = new THREE.LineSegments(lineGeo, lineMat);
        scene.add(lineSegments);

        // ── Mouse parallax suave ──────────────────────────────────────────
        let mouseX = 0;
        let mouseY = 0;
        let targetRotX = 0;
        let targetRotY = 0;

        document.addEventListener('mousemove', function (e) {
            mouseX = (e.clientX / window.innerWidth  - 0.5) * 0.4;
            mouseY = (e.clientY / window.innerHeight - 0.5) * 0.4;
        });

        // ── Redimensionamento ─────────────────────────────────────────────
        window.addEventListener('resize', function () {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // ── Loop de animação ──────────────────────────────────────────────
        let frame = 0;

        function animate() {
            requestAnimationFrame(animate);
            frame++;

            const pos = particleGeo.attributes.position.array;

            // Mover cada partícula
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const i3 = i * 3;
                const v = velocities[i];

                pos[i3]     += v.vx;
                pos[i3 + 1] += v.vy;
                pos[i3 + 2] += v.vz;

                // Wrap around: se sair do volume, volta do outro lado
                const half = SPREAD / 2;
                if (pos[i3]     >  half) pos[i3]     = -half;
                if (pos[i3]     < -half) pos[i3]     =  half;
                if (pos[i3 + 1] >  half) pos[i3 + 1] = -half;
                if (pos[i3 + 1] < -half) pos[i3 + 1] =  half;
                if (pos[i3 + 2] >  half) pos[i3 + 2] = -half;
                if (pos[i3 + 2] < -half) pos[i3 + 2] =  half;
            }
            particleGeo.attributes.position.needsUpdate = true;

            // Atualizar linhas de conexão (a cada 2 frames por performance)
            if (frame % 2 === 0) {
                let lineIndex = 0;
                const lp = lineGeo.attributes.position.array;

                outer: for (let i = 0; i < PARTICLE_COUNT && lineIndex < MAX_LINES; i++) {
                    const i3 = i * 3;
                    const ax = pos[i3], ay = pos[i3 + 1], az = pos[i3 + 2];

                    for (let j = i + 1; j < PARTICLE_COUNT && lineIndex < MAX_LINES; j++) {
                        const j3 = j * 3;
                        const dx = ax - pos[j3];
                        const dy = ay - pos[j3 + 1];
                        const dz = az - pos[j3 + 2];
                        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                        if (dist < MAX_DISTANCE) {
                            const base = lineIndex * 6;
                            lp[base]     = ax; lp[base + 1] = ay; lp[base + 2] = az;
                            lp[base + 3] = pos[j3]; lp[base + 4] = pos[j3 + 1]; lp[base + 5] = pos[j3 + 2];
                            lineIndex++;
                        }
                    }
                }

                // Zera linhas não usadas
                for (let k = lineIndex * 6; k < MAX_LINES * 6; k++) lp[k] = 0;
                lineGeo.attributes.position.needsUpdate = true;
                lineGeo.setDrawRange(0, lineIndex * 2);
            }

            // Parallax com mouse (interpolação suave)
            targetRotY += (mouseX - targetRotY) * 0.03;
            targetRotX += (mouseY - targetRotX) * 0.03;

            // Rotação global lenta
            particles.rotation.y   = targetRotY + frame * 0.0003;
            particles.rotation.x   = targetRotX + frame * 0.0001;
            lineSegments.rotation.y = particles.rotation.y;
            lineSegments.rotation.x = particles.rotation.x;

            renderer.render(scene, camera);
        }

        animate();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { waitForThree(init); });
    } else {
        waitForThree(init);
    }
})();
