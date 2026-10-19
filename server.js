require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");

const db = require("./database");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const production = process.env.NODE_ENV === "production";

app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({
  extended: false,
  limit: "16kb"
}));

app.use(session({
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: "/tmp" // Di Vercel, direktori sementara yang bisa ditulis hanya /tmp
  }),
  name: "phz.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: production,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, "public")));

app.use("/api/", rateLimit({
  windowMs: 60 * 1000,
  limit: 60
}));

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10
});

let midtrans = null;

if (
  process.env.MIDTRANS_SERVER_KEY &&
  process.env.MIDTRANS_CLIENT_KEY
) {
  const midtransClient = require("midtrans-client");

  midtrans = new midtransClient.Snap({
    isProduction:
      process.env.MIDTRANS_IS_PRODUCTION === "true",
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
  });
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Silakan login sebagai admin."
    });
  }

  next();
}

function safeProduct(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    description: product.description,
    price: product.price,
    stock: product.stock,
    image: product.image,
    active: Boolean(product.active)
  };
}

app.get("/api/products", (req, res) => {
  const products = db.prepare(`
    SELECT id, name, category, description,
           price, stock, image, active
    FROM products
    WHERE active = 1
    ORDER BY id DESC
  `).all();

  res.json(products.map(safeProduct));
});

app.post(
  "/api/admin/login",
  adminLimiter,
  async (req, res) => {
    const { username, password } = req.body || {};

    const hash = process.env.ADMIN_PASSWORD_HASH;

    if (!hash || !process.env.SESSION_SECRET) {
      return res.status(503).json({
        error: "Konfigurasi admin belum lengkap."
      });
    }

    const validUsername =
      typeof username === "string" &&
      username === process.env.ADMIN_USERNAME;

    const validPassword =
      typeof password === "string" &&
      password.length <= 200 &&
      await bcrypt.compare(password, hash);

    if (!validUsername || !validPassword) {
      return res.status(401).json({
        error: "Username atau password salah."
      });
    }

    req.session.regenerate(err => {
      if (err) {
        return res.status(500).json({
          error: "Gagal membuat sesi."
        });
      }

      req.session.admin = true;

      res.json({ success: true });
    });
  }
);

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("phz.sid");
    res.json({ success: true });
  });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const orders = db.prepare(`
    SELECT id, invoice, customer_name, customer_email,
           product_name, quantity, total,
           payment_method, payment_status,
           fulfillment_status, created_at
    FROM orders
    ORDER BY id DESC
    LIMIT 200
  `).all();

  res.json(orders);
});

app.post("/api/admin/products", requireAdmin, (req, res) => {
  const {
    name,
    category,
    description,
    price,
    stock,
    image
  } = req.body || {};

  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 120 ||
    typeof category !== "string" ||
    category.length > 80 ||
    !Number.isSafeInteger(price) ||
    price < 0 ||
    !Number.isSafeInteger(stock) ||
    stock < 0 ||
    stock > 1000000
  ) {
    return res.status(400).json({
      error: "Data produk tidak valid."
    });
  }

  const result = db.prepare(`
    INSERT INTO products
    (name, category, description, price, stock, image)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    category.trim(),
    String(description || "").slice(0, 1000),
    price,
    stock,
    typeof image === "string" &&
    /^https:\/\/[^\s]+$/i.test(image)
      ? image.slice(0, 1000)
      : ""
  );

  res.status(201).json({
    success: true,
    id: result.lastInsertRowid
  });
});

app.patch(
  "/api/admin/products/:id",
  requireAdmin,
  (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "ID produk tidak valid."
      });
    }

    const fields = [
      "name",
      "category",
      "description",
      "price",
      "stock",
      "image",
      "active"
    ];

    const updates = [];
    const values = [];

    for (const field of fields) {
      if (!Object.hasOwn(req.body || {}, field)) continue;

      const value = req.body[field];

      if (field === "name" || field === "category") {
        if (
          typeof value !== "string" ||
          !value.trim() ||
          value.length > 120
        ) {
          return res.status(400).json({
            error: `Nilai ${field} tidak valid.`
          });
        }

        updates.push(`${field} = ?`);
        values.push(value.trim());
      } else if (field === "description") {
        if (typeof value !== "string") {
          return res.status(400).json({
            error: "Deskripsi tidak valid."
          });
        }

        updates.push("description = ?");
        values.push(value.slice(0, 1000));
      } else if (field === "price") {
        if (!Number.isSafeInteger(value) || value < 0) {
          return res.status(400).json({
            error: "Harga tidak valid."
          });
        }

        updates.push("price = ?");
        values.push(value);
      } else if (field === "stock") {
        if (
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > 1000000
        ) {
          return res.status(400).json({
            error: "Stok tidak valid."
          });
        }

        updates.push("stock = ?");
        values.push(value);
      } else if (field === "active") {
        if (![0, 1, true, false].includes(value)) {
          return res.status(400).json({
            error: "Status produk tidak valid."
          });
        }

        updates.push("active = ?");
        values.push(value ? 1 : 0);
      } else if (field === "image") {
        if (
          typeof value !== "string" ||
          (value && !/^https:\/\/[^\s]+$/i.test(value))
        ) {
          return res.status(400).json({
            error: "URL gambar harus menggunakan HTTPS."
          });
        }

        updates.push("image = ?");
        values.push(value.slice(0, 1000));
      }
    }

    if (!updates.length) {
      return res.status(400).json({
        error: "Tidak ada perubahan."
      });
    }

    values.push(id);

    const result = db.prepare(`
      UPDATE products
      SET ${updates.join(", ")}
      WHERE id = ?
    `).run(...values);

    if (!result.changes) {
      return res.status(404).json({
        error: "Produk tidak ditemukan."
      });
    }

    res.json({ success: true });
  }
);

app.post("/api/orders", async (req, res) => {
  const {
    productId,
    quantity,
    customerName,
    customerEmail
  } = req.body || {};

  if (
    !Number.isSafeInteger(productId) ||
    productId <= 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 10 ||
    typeof customerName !== "string" ||
    !customerName.trim() ||
    customerName.length > 100 ||
    (
      customerEmail &&
      (
        typeof customerEmail !== "string" ||
        customerEmail.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)
      )
    )
  ) {
    return res.status(400).json({
      error: "Data pesanan tidak valid."
    });
  }

  const product = db.prepare(`
    SELECT * FROM products
    WHERE id = ? AND active = 1
  `).get(productId);

  if (!product) {
    return res.status(404).json({
      error: "Produk tidak ditemukan."
    });
  }

  if (product.stock < quantity) {
    return res.status(400).json({
      error: "Stok tidak mencukupi."
    });
  }

  const total = product.price * quantity;

  if (!Number.isSafeInteger(total) || total <= 0) {
    return res.status(400).json({
      error: "Total pesanan tidak valid."
    });
  }

  const invoice =
    "PHZ-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    crypto.randomBytes(4).toString("hex").toUpperCase();

  const createOrder = db.transaction(() => {
    const current = db.prepare(`
      SELECT stock, price, active
      FROM products WHERE id = ?
    `).get(productId);

    if (
      !current ||
      !current.active ||
      current.stock < quantity ||
      current.price !== product.price
    ) {
      throw new Error("PRODUCT_CHANGED");
    }

    const result = db.prepare(`
      INSERT INTO orders (
        invoice, customer_name, customer_email,
        product_id, product_name, quantity,
        unit_price, total, payment_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      invoice,
      customerName.trim(),
      customerEmail || "",
      product.id,
      product.name,
      quantity,
      product.price,
      total
    );

    return result.lastInsertRowid;
  });

  let orderId;

  try {
    orderId = createOrder();
  } catch {
    return res.status(409).json({
      error: "Produk berubah. Silakan coba lagi."
    });
  }

  let paymentUrl = null;
  let paymentToken = null;

  if (midtrans) {
    try {
      const transaction = await midtrans.createTransaction({
        transaction_details: {
          order_id: invoice,
          gross_amount: total
        },
        item_details: [{
          id: String(product.id),
          price: product.price,
          quantity,
          name: product.name.slice(0, 50)
        }],
        customer_details: {
          first_name: customerName.trim(),
          email: customerEmail || undefined
        }
      });

      paymentUrl = transaction.redirect_url;
      paymentToken = transaction.token;

      db.prepare(`
        UPDATE orders
        SET payment_url = ?, payment_token = ?
        WHERE id = ?
      `).run(paymentUrl, paymentToken, orderId);
    } catch (error) {
      console.error("Midtrans error:", error.message);

      return res.status(502).json({
        error: "Pembayaran gagal dibuat. Silakan coba kembali."
      });
    }
  }

  res.status(201).json({
    success: true,
    invoice,
    total,
    paymentUrl,
    paymentToken,
    paymentConfigured: Boolean(midtrans),
    message: midtrans
      ? "Lanjutkan pembayaran melalui halaman pembayaran."
      : "Pesanan dibuat. Pembayaran belum dikonfigurasi."
  });
});

app.post("/api/payments/midtrans/notification", async (req, res) => {
  if (!midtrans) {
    return res.status(503).json({
      error: "Pembayaran belum dikonfigurasi."
    });
  }

  try {
    const status = await midtrans.transaction.notification(req.body);

    const invoice = status.order_id;

    const order = db.prepare(`
      SELECT * FROM orders WHERE invoice = ?
    `).get(invoice);

    if (!order) {
      return res.status(404).json({
        error: "Pesanan tidak ditemukan."
      });
    }

    if (
      Number(status.gross_amount) !== order.total
    ) {
      return res.status(400).json({
        error: "Nominal pembayaran tidak cocok."
      });
    }

    let paymentStatus = "pending";

    if (
      status.transaction_status === "capture" &&
      status.fraud_status === "accept"
    ) {
      paymentStatus = "paid";
    } else if (
      status.transaction_status === "settlement"
    ) {
      paymentStatus = "paid";
    } else if (
      ["deny", "cancel", "expire", "failure"].includes(
        status.transaction_status
      )
    ) {
      paymentStatus = "failed";
    } else if (
      status.transaction_status === "pending"
    ) {
      paymentStatus = "pending";
    }

    const update = db.transaction(() => {
      const current = db.prepare(`
        SELECT * FROM orders WHERE invoice = ?
      `).get(invoice);

      if (!current || current.payment_status === "paid") {
        return;
      }

      if (paymentStatus === "paid") {
        const product = db.prepare(`
          SELECT stock FROM products WHERE id = ?
        `).get(current.product_id);

        if (!product || product.stock < current.quantity) {
          throw new Error("STOCK_UNAVAILABLE");
        }

        db.prepare(`
          UPDATE products
          SET stock = stock - ?
          WHERE id = ?
        `).run(current.quantity, current.product_id);
      }

      db.prepare(`
        UPDATE orders
        SET payment_status = ?
        WHERE invoice = ?
      `).run(paymentStatus, invoice);
    });

    update();

    res.json({ success: true });
  } catch (error) {
    console.error("Payment notification error:", error.message);

    res.status(400).json({
      error: "Notifikasi pembayaran tidak dapat diproses."
    });
  }
});

app.get("/api/orders/:invoice", (req, res) => {
  const order = db.prepare(`
    SELECT invoice, product_name, quantity, total,
           payment_status, fulfillment_status, created_at
    FROM orders WHERE invoice = ?
  `).get(req.params.invoice);

  if (!order) {
    return res.status(404).json({
      error: "Pesanan tidak ditemukan."
    });
  }

  res.json(order);
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Jalankan app.listen HANYA jika dijalankan secara lokal (bukan di Vercel)
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PH × Zoll Digital Store berjalan di port ${PORT}`);
  });
}

// Ekspor aplikasi agar bisa dibaca oleh Vercel Serverless Functions
module.exports = app;
                        
