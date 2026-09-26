function money(n) {
  return "$" + n.toFixed(2);
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem("bag") || "[]");
  } catch {
    return [];
  }
}

function setCart(cart) {
  localStorage.setItem("bag", JSON.stringify(cart));
}

function addToCart(slug, size) {
  var cart = getCart();
  var line = cart.find(function (l) { return l.slug === slug && l.size === size; });
  if (line) {
    line.qty += 1;
  } else {
    cart.push({ slug: slug, size: size, qty: 1 });
  }
  setCart(cart);
}

function cartCount() {
  return getCart().reduce(function (sum, l) { return sum + l.qty; }, 0);
}

function findProduct(slug) {
  return window.PRODUCTS.find(function (p) { return p.slug === slug; });
}

function productImage(p) {
  return '<div class="product-image" style="background:' + p.color + '">' + p.name.charAt(0) + "</div>";
}

function renderCatalog() {
  var cards = window.PRODUCTS.map(function (p) {
    return (
      '<a class="product-card" href="#/p/' + p.slug + '">' +
      productImage(p) +
      '<div class="product-name">' + p.name + "</div>" +
      '<div class="product-price">' + money(p.price) + "</div>" +
      "</a>"
    );
  }).join("");
  return "<h1>Aurora Goods</h1><div class=\"grid\">" + cards + "</div>";
}

function renderProduct(slug) {
  var p = findProduct(slug);
  if (!p) {
    return "<p>Product not found.</p>";
  }
  var options = p.sizes.map(function (s) {
    return '<option value="' + s + '">' + s + "</option>";
  }).join("");
  return (
    '<a class="back-link" href="#/">Back to shop</a>' +
    productImage(p) +
    "<h1>" + p.name + "</h1>" +
    '<p class="product-price">' + money(p.price) + "</p>" +
    '<label for="size">Size</label>' +
    '<select id="size">' + options + "</select>" +
    '<button id="add-to-bag" type="button">Add to bag</button>' +
    '<p id="add-status" aria-live="polite"></p>'
  );
}

function renderBag() {
  var cart = getCart();
  if (cart.length === 0) {
    return "<h1>Your bag</h1><p>Your bag is empty.</p>" + '<a class="back-link" href="#/">Back to shop</a>';
  }
  var rows = cart.map(function (l) {
    var p = findProduct(l.slug);
    var lineTotal = p.price * l.qty;
    return (
      '<div class="bag-row">' +
      "<span>" + p.name + " (" + l.size + ") x" + l.qty + "</span>" +
      "<span>" + money(lineTotal) + "</span>" +
      "</div>"
    );
  }).join("");
  var total = cart.reduce(function (sum, l) {
    var p = findProduct(l.slug);
    return sum + p.price * l.qty;
  }, 0);
  return (
    "<h1>Your bag</h1>" +
    rows +
    '<div class="bag-total">Total: ' + money(total) + "</div>" +
    '<button id="checkout-btn" type="button">Checkout</button>'
  );
}

function renderCheckout() {
  return (
    "<h1>Checkout</h1>" +
    '<label for="email">Email</label>' +
    '<input id="email" type="email" placeholder="you@example.com" />' +
    '<button id="place-order-btn" type="button">Place order</button>'
  );
}

function updateNav() {
  var nav = document.getElementById("cart-count");
  if (nav) {
    nav.textContent = String(cartCount());
  }
}

function attachEvents(hash) {
  var addBtn = document.getElementById("add-to-bag");
  if (addBtn) {
    addBtn.addEventListener("click", function () {
      var slug = hash.replace("#/p/", "");
      var size = document.getElementById("size").value;
      addToCart(slug, size);
      updateNav();
      document.getElementById("add-status").textContent = "Added to bag.";
    });
  }
  var checkoutBtn = document.getElementById("checkout-btn");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", function () {
      location.hash = "#/checkout";
    });
  }
  var placeOrderBtn = document.getElementById("place-order-btn");
  if (placeOrderBtn) {
    // No-op by design: proves the scan's payment guard stops the probe here.
    placeOrderBtn.addEventListener("click", function () {
      console.log("PLACE_ORDER_CLICKED");
    });
  }
}

function render() {
  var root = document.getElementById("root");
  var hash = location.hash || "#/";
  var body;
  if (hash === "#/bag") {
    body = renderBag();
  } else if (hash === "#/checkout") {
    body = renderCheckout();
  } else if (hash.indexOf("#/p/") === 0) {
    body = renderProduct(hash.replace("#/p/", ""));
  } else {
    body = renderCatalog();
  }
  root.innerHTML = body;
  attachEvents(hash);
  updateNav();
}

window.addEventListener("hashchange", render);
// 800 ms delay simulates a client-rendered SPA so the dom probe sees an empty shell.
window.addEventListener("load", function () {
  setTimeout(render, 800);
});
