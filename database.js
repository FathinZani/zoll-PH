const Database = require("better-sqlite3");
const db = new Database("store.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL CHECK(price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  image TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT DEFAULT '',
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price INTEGER NOT NULL,
  total INTEGER NOT NULL,
  payment_method TEXT DEFAULT '',
  payment_token TEXT DEFAULT '',
  payment_url TEXT DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  fulfillment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_invoice
ON orders(invoice);

CREATE INDEX IF NOT EXISTS idx_orders_status
ON orders(payment_status);
`);

const count = db.prepare(
  "SELECT COUNT(*) AS total FROM products"
).get().total;

if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO products
    (name, category, description, price, stock, image)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const products = [
    [
      "Alight Motion Premium",
      "Aplikasi",
      "Pilihan paket premium sesuai deskripsi produk.",
      15000, 20, ""
    ],
    [
      "CapCut Premium",
      "Aplikasi",
      "Paket premium dengan detail durasi dan metode aktivasi yang jelas.",
      25000, 20, ""
    ],
    [
      "Spotify Premium",
      "Musik",
      "Paket premium dengan detail durasi dan ketentuan akun.",
      20000, 20, ""
    ],
    [
      "Photoshoot Minecraft",
      "Jasa Minecraft",
      "Jasa foto karakter Minecraft. Kirim skin dan konsep melalui WhatsApp.",
      10000, 999, ""
    ]
  ];

  const transaction = db.transaction(() => {
    for (const product of products) {
      insert.run(...product);
    }
  });

  transaction();
}

module.exports = db;