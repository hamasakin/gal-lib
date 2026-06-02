// Verifies the new updater-prompt i18n keys exist in all three locales.
const path = require("path");
const root = path.resolve(__dirname, "..", "..", "..");
const locales = ["zh-CN", "en-US", "ja-JP"];
const keys = [
  "toast.update_available",
  "toast.update_available_desc",
  "toast.update_now",
  "toast.update_downloading",
  "about.update_available",
  "about.download_update",
];
for (const l of locales) {
  const o = require(path.join(root, "src", "locales", l, "translation.json"));
  for (const k of keys) {
    if (!(k in o)) {
      console.error(`${l} missing ${k}`);
      process.exit(1);
    }
  }
}
console.log("i18n keys ok");
