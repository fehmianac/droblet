/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static files in out/ — served from an S3 website bucket behind Cloudflare. Nothing runs at request time.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
