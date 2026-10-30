import QRCode from 'qrcode';

/**
 * Generate a high-resolution PNG Data URL for a partner registration URL
 */
export async function generateQrPngDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    margin: 2,
    width: 600,
    color: {
      dark: '#1e40af', // IOTA Blue
      light: '#ffffff'
    }
  });
}

/**
 * Generate a scalable SVG string for print-ready promotional posters
 */
export async function generateQrSvgString(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 2,
    color: {
      dark: '#1e40af',
      light: '#ffffff'
    }
  });
}

