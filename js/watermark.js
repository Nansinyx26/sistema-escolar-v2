/**
 * Watermark Component
 * Injects the complex 3D watermark HTML structure
 */
document.addEventListener('DOMContentLoaded', () => {
    const existingWatermark = document.querySelector('.watermark');
    const watermarkHTML = `
        <div class="cube-container">
            <div class="wireframe-cube">
                <div class="cube-face front"></div>
                <div class="cube-face back"></div>
                <div class="cube-face right"></div>
                <div class="cube-face left"></div>
                <div class="cube-face top"></div>
                <div class="cube-face bottom"></div>
                <div class="wireframe-lines">
                    <div class="inner-line horizontal-line line-1"></div>
                    <div class="inner-line horizontal-line line-2"></div>
                    <div class="inner-line horizontal-line line-3"></div>
                    <div class="inner-line vertical-line v-line-1"></div>
                    <div class="inner-line vertical-line v-line-2"></div>
                    <div class="inner-line vertical-line v-line-3"></div>
                </div>
            </div>
        </div>
        <span class="watermark-text">
            Desenvolvido por <span class="watermark-highlight">Nan Dev</span>
        </span>
        <div class="geometric-particles">
            <div class="particle"></div>
            <div class="particle"></div>
            <div class="particle"></div>
            <div class="particle"></div>
            <div class="particle"></div>
        </div>
        <div class="holographic-overlay"></div>
    `;

    // Create the new element
    const newWatermark = document.createElement('a');
    newWatermark.href = 'https://nansinyx26.github.io/Portifolio-2026-Renan-Farias/';
    newWatermark.target = '_blank'; // Good practice for external links
    newWatermark.className = 'nandev-watermark';
    newWatermark.innerHTML = watermarkHTML;

    // Replace existing or append to body
    if (existingWatermark) {
        existingWatermark.replaceWith(newWatermark);
    } else {
        document.body.appendChild(newWatermark);
    }
});
