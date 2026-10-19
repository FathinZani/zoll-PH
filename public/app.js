const productGrid = document.getElementById("productGrid");
const productSelect = document.getElementById("productSelect");
const orderForm = document.getElementById("orderForm");
const orderMessage = document.getElementById("orderMessage");

let products = [];
let activeCategory = "all";

const icons = {
  "Aplikasi": "✧",
  "Musik": "♫",
  "Jasa Minecraft": "⬡"
};

function rupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(value);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function renderProducts() {
  const filtered = products.filter(product =>
    activeCategory === "all" ||
    product.category === activeCategory
  );

  if (!filtered.length) {
    productGrid.innerHTML = `
      <div class="empty-state">
        Belum ada produk dalam kategori ini.
      </div>
    `;
    return;
  }

  productGrid.innerHTML = filtered.map(product => `
    <article class="product-card glass">
      <div class="product-image">
        ${
          product.image
            ? `<img
                src="${escapeHTML(product.image)}"
                alt="${escapeHTML(product.name)}"
                loading="lazy"
              >`
            : `<span>${icons[product.category] || "✦"}</span>`
        }
      </div>

      <div class="product-body">
        <span class="product-category">
          ${escapeHTML(product.category)}
        </span>

        <h3>${escapeHTML(product.name)}</h3>

        <p>${escapeHTML(product.description)}</p>

        <div class="product-price">
          ${rupiah(product.price)}
        </div>

        <span class="stock">
          ${
            product.stock > 0
              ? "Stok tersedia"
              : "Stok habis"
          }
        </span>

        <button
          class="button product-buy"
          data-buy="${product.id}"
          ${product.stock < 1 ? "disabled" : ""}
        >
          ${product.stock > 0 ? "Pesan Sekarang →" : "Stok Habis"}
        </button>
      </div>
    </article>
  `).join("");
}

function renderSelect() {
  productSelect.innerHTML = `
    <option value="">Pilih produk...</option>
  `;

  for (const product of products) {
    if (product.stock < 1) continue;

    const option = document.createElement("option");
    option.value = product.id;
    option.textContent =
      `${product.name} — ${rupiah(product.price)}`;

    productSelect.appendChild(option);
  }
}

async function loadProducts() {
  try {
    const response = await fetch("/api/products");

    if (!response.ok) {
      throw new Error("Gagal memuat katalog.");
    }

    products = await response.json();

    renderProducts();
    renderSelect();
  } catch {
    productGrid.innerHTML = `
      <div class="empty-state">
        Katalog belum dapat dimuat. Silakan muat ulang halaman.
      </div>
    `;
  }
}

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach(item => {
      item.classList.remove("active");
    });

    button.classList.add("active");
    activeCategory = button.dataset.category;

    renderProducts();
  });
});

productGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-buy]");

  if (!button) return;

  productSelect.value = button.dataset.buy;

  document.getElementById("order").scrollIntoView({
    behavior: "smooth"
  });
});

function showMessage(message, isError = false) {
  orderMessage.hidden = false;
  orderMessage.style.borderColor = isError
    ? "rgba(255,100,100,.6)"
    : "rgba(120,255,180,.5)";

  orderMessage.textContent = message;
}

orderForm.addEventListener("submit", async event => {
  event.preventDefault();

  const submitButton = orderForm.querySelector(
    'button[type="submit"]'
  );

  submitButton.disabled = true;
  submitButton.textContent = "Memproses...";

  try {
    const form = new FormData(orderForm);

    const payload = {
      customerName: form.get("customerName"),
      customerEmail: form.get("customerEmail"),
      productId: Number(form.get("productId")),
      quantity: Number(form.get("quantity"))
    };

    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Pesanan gagal dibuat.");
    }

    showMessage(
      `Pesanan berhasil dibuat. Invoice: ${result.invoice}. ` +
      `Total: ${rupiah(result.total)}.`
    );

    if (result.paymentUrl) {
      const link = document.createElement("a");
      link.href = result.paymentUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "button";
      link.textContent = "Lanjutkan Pembayaran";

      orderMessage.appendChild(document.createElement("br"));
      orderMessage.appendChild(document.createElement("br"));
      orderMessage.appendChild(link);
    } else {
      const note = document.createElement("p");

      note.textContent =
        "Pembayaran online belum dikonfigurasi. " +
        "Jangan menganggap pesanan sudah lunas.";

      orderMessage.appendChild(note);
    }

    orderForm.reset();
    await loadProducts();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Buat Pesanan →";
  }
});

loadProducts();
