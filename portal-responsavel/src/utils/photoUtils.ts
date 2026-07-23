/**
 * Resolves a photo source into a valid URL.
 * Handles GridFS IDs, full URLs (Google), Base64, and fallbacks.
 */
export const getPhotoUrl = (foto?: string, fotoGoogle?: string): string => {
  if (fotoGoogle && (fotoGoogle.startsWith('http') || fotoGoogle.startsWith('https'))) {
    return fotoGoogle;
  }

  if (foto) {
    // If it's already a full URL or data URI, return as is
    if (foto.startsWith('http') || foto.startsWith('data:')) {
      return foto;
    }
    
    // If it's a GridFS ID (usually 24 hex chars)
    if (foto.length === 24 || /^[0-9a-fA-F]{24}$/.test(foto)) {
      return `/api/files/${foto}`;
    }

    // Default case for stored names/IDs
    return `/api/files/${foto}`;
  }

  return '/img/default-avatar.png';
};
