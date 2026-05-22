// Picks a project's hero image so the Dashboard can show a recognizable
// thumbnail. Reuses whatever image the builder already wired into the site —
// AI-generated images land either as fal.media URLs or as project-owned R2
// assets ("/assets/<projectId>/<file>").

function isHeroFile(path: string): boolean {
  return /hero/i.test(path);
}

function isPageFile(path: string): boolean {
  return /(^|\/)(app|home|index|page)\.(tsx|jsx|js)$/i.test(path);
}

// A URL points at a usable image when it has an image extension or sits under
// an /assets/ path. Font and CDN URLs are excluded so they can't win.
function imageUrlsIn(content: string): string[] {
  const all = content.match(/https?:\/\/[^\s"'`)\]}]+/g) || [];
  return all.filter((url) => {
    const lower = url.toLowerCase();
    if (
      lower.includes("placehold.co") ||
      lower.includes("tailwindcss.com") ||
      lower.includes("fonts.googleapis.com") ||
      lower.includes("fonts.gstatic.com")
    ) {
      return false;
    }
    return /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url) || url.includes("/assets/");
  });
}

/**
 * Returns the URL of the project's hero image, or null when the project has
 * no images. Searches hero files first, then top-level page files, then
 * everything — and within a file takes the first image URL, since hero images
 * are placed at the top of these files.
 */
export function extractHeroImageUrl(
  files: Record<string, string>,
): string | null {
  const tiers: Array<(path: string) => boolean> = [
    isHeroFile,
    isPageFile,
    () => true,
  ];

  for (const matchesTier of tiers) {
    for (const [path, content] of Object.entries(files)) {
      if (!matchesTier(path)) continue;
      const urls = imageUrlsIn(content);
      if (urls.length > 0) return urls[0];
    }
  }

  return null;
}
