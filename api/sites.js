import sites from "../sites.json" assert { type: "json" };

export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json({ count: sites.length, sites });
}