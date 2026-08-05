const sharp = require('sharp');

/**
 * Image Processor Utility
 */
const ImageProcessor = {
    /**
     * Converte uma string Base64 ou Buffer para WebP Base64
     * @param {string|Buffer} input - Imagem de entrada
     * @param {number} quality - Qualidade da compressão (1-100)
     * @returns {Promise<string>} - String Base64 da imagem WebP (com prefixo data:image/webp;base64,)
     */
    async convertToWebPBase64(input, quality = 80) {
        try {
            let buffer;

            // Se for string base64, remover prefixo se existir e converter para buffer
            if (typeof input === 'string') {
                if (input.includes('base64,')) {
                    input = input.split('base64,')[1];
                }
                buffer = Buffer.from(input, 'base64');
            } else {
                buffer = input;
            }

            const pcdBuffer = await sharp(buffer)
                .webp({ quality: quality })
                .toBuffer();

            return `data:image/webp;base64,${pcdBuffer.toString('base64')}`;
        } catch (error) {
            console.error('Erro na conversão para WebP:', error);
            // Em caso de erro, retorna original ou lança, dependendo da estratégia. 
            // Aqui, vamos relançar para que o controller saiba.
            throw error;
        }
    },

    /**
     * Verifica se o input parece ser uma imagem Base64 válida (não WebP)
     * @param {string} input 
     * @returns {boolean}
     */
    isBase64Image(input) {
        if (typeof input !== 'string') return false;
        // Detecta apenas strings que realmente parecem ser imagens base64
        // Exige prefixo data:image/ OU padrão base64 longo com caracteres válidos
        if (input.startsWith('data:image/')) return true;
        // Heurística para base64 puro: deve ter pelo menos 500 chars e conter apenas caracteres base64 válidos
        if (input.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(input.substring(0, 100))) return true;
        return false;
    }
};

module.exports = ImageProcessor;
