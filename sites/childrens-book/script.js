(function () {
  // |---Book shop and checkout config---|
  var BOOK_DIRECT = {
    contactEmail: "you@example.com",
    bookTitle: "Your Magical Book Title",
    bookTrailerEmbedUrl: "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw",
    retailerPaypalUrl: "https://www.paypal.com/paypalme/yourname",
    defaultPaypalUrl: "https://www.paypal.com/paypalme/yourname",
    editions: [
      {
        id: "hardcover",
        label: "Hardcover",
        priceLabel: "$18.99",
        checkoutUrl: "",
        paypalUrl: "https://www.paypal.com/paypalme/yourname/18.99",
      },
      {
        id: "paperback",
        label: "Paperback",
        priceLabel: "$12.99",
        checkoutUrl: "",
        paypalUrl: "https://www.paypal.com/paypalme/yourname/12.99",
      },
    ],
  };

  // |---Newsletter signup endpoint---|
  var NEWSLETTER = {
    formAction: "",
    stayOnPage: true,
    ownerEmailSubject: "New signup from book site",
  };

  // |---Buy-direct form copy for visitors---|
  var SITE_COPY = {
    submitWithCard: "Continue to checkout",
    submitWithPayPalOnly: "Continue with PayPal",
    submitEmailOnly: "Email order request",
    hintCardAndPayPal:
      "Next step: secure payment page. You can also use PayPal below.",
    hintCardOnly: "Next step: secure payment page — card and wallet options as available.",
    hintPayPalOnly: "You’ll complete payment on PayPal’s secure site.",
    hintEmailOnly: "We’ll open your email with a pre-filled message to complete your order.",
    invalidEmail: "Enter a valid email, or leave the field blank.",
  };

  // |---Stripe checkout URL helpers---|
  function appendStripePrefill(url, email) {
    if (!email) return url;
    if (!/stripe\.com/i.test(url)) return url;
    var sep = url.indexOf("?") >= 0 ? "&" : "?";
    return url + sep + "prefilled_email=" + encodeURIComponent(email);
  }

  function editionById(id) {
    for (var i = 0; i < BOOK_DIRECT.editions.length; i++) {
      if (BOOK_DIRECT.editions[i].id === id) return BOOK_DIRECT.editions[i];
    }
    return BOOK_DIRECT.editions[0];
  }

  function paypalUrlForEdition(ed) {
    var direct = (ed.paypalUrl || "").trim();
    if (direct) return direct;
    return (BOOK_DIRECT.defaultPaypalUrl || "").trim();
  }

  // |---Book trailer iframe---|
  function initBookTrailer() {
    var iframe = document.getElementById("book-trailer-iframe");
    var url = (BOOK_DIRECT.bookTrailerEmbedUrl || "").trim();
    if (!iframe) return;
    if (url) {
      iframe.src = url;
      return;
    }
    var section = document.getElementById("video");
    if (section) section.hidden = true;
    var navLink = document.querySelector('a[href="#video"]');
    if (navLink) navLink.hidden = true;
  }

  // |---Retailer PayPal button---|
  function initRetailPayPal() {
    var link = document.getElementById("retail-paypal");
    if (!link) return;
    var url = (BOOK_DIRECT.retailerPaypalUrl || "").trim();
    if (url) {
      link.href = url;
      link.hidden = false;
    } else {
      link.hidden = true;
    }
  }

  // |---Buy direct form (editions, Stripe, PayPal, mailto)---|
  function initBuyDirect() {
    var form = document.getElementById("buy-direct-form");
    var select = document.getElementById("buy-direct-edition");
    var emailInput = document.getElementById("buy-direct-email");
    var hint = document.getElementById("buy-direct-hint");
    var submitBtn = document.getElementById("buy-direct-submit");
    var titleEl = document.getElementById("buy-direct-book-title");
    var summaryEdition = document.getElementById("buy-direct-summary-edition");
    var summaryPrice = document.getElementById("buy-direct-summary-price");
    var paypalBtn = document.getElementById("buy-direct-paypal");
    if (!form || !select || !emailInput || !hint || !submitBtn) return;

    if (titleEl && BOOK_DIRECT.bookTitle) {
      titleEl.textContent = BOOK_DIRECT.bookTitle;
    }

    select.innerHTML = "";
    BOOK_DIRECT.editions.forEach(function (ed) {
      var opt = document.createElement("option");
      opt.value = ed.id;
      opt.textContent = ed.label + " — " + ed.priceLabel;
      select.appendChild(opt);
    });

    function updateOrderSummary() {
      var ed = editionById(select.value);
      if (summaryEdition) summaryEdition.textContent = ed.label;
      if (summaryPrice) summaryPrice.textContent = ed.priceLabel;
    }

    function syncPayPalButton() {
      if (!paypalBtn) return;
      var ed = editionById(select.value);
      var pUrl = paypalUrlForEdition(ed);
      var cardUrl = (ed.checkoutUrl || "").trim();
      if (pUrl && cardUrl) {
        paypalBtn.href = pUrl;
        paypalBtn.hidden = false;
      } else {
        paypalBtn.hidden = true;
      }
    }

    function syncHint() {
      hint.classList.remove("is-error");
      var ed = editionById(select.value);
      var cardUrl = (ed.checkoutUrl || "").trim();
      var pUrl = paypalUrlForEdition(ed);
      var C = SITE_COPY;

      if (cardUrl) {
        submitBtn.textContent = C.submitWithCard;
        hint.textContent = pUrl ? C.hintCardAndPayPal : C.hintCardOnly;
      } else if (pUrl) {
        hint.textContent = C.hintPayPalOnly;
        submitBtn.textContent = C.submitWithPayPalOnly;
      } else {
        hint.textContent = C.hintEmailOnly;
        submitBtn.textContent = C.submitEmailOnly;
      }
    }

    function syncAll() {
      updateOrderSummary();
      syncPayPalButton();
      syncHint();
    }

    syncAll();
    select.addEventListener("change", syncAll);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      hint.classList.remove("is-error");
      var ed = editionById(select.value);
      var rawEmail = emailInput.value.trim();
      var url = (ed.checkoutUrl || "").trim();
      var payPal = paypalUrlForEdition(ed);

      if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        hint.textContent = SITE_COPY.invalidEmail;
        hint.classList.add("is-error");
        emailInput.focus();
        return;
      }

      if (url) {
        var dest = appendStripePrefill(url, rawEmail);
        window.location.assign(dest);
        return;
      }

      if (payPal) {
        window.location.assign(payPal);
        return;
      }

      // |---Mailto order fallback---|
      var subject =
        "Direct order: " + BOOK_DIRECT.bookTitle + " (" + ed.label + " " + ed.priceLabel + ")";
      var body =
        "Hi,\r\n\r\n" +
        "I'd like to order:\r\n\r\n" +
        "Book: " +
        BOOK_DIRECT.bookTitle +
        "\r\n" +
        "Edition: " +
        ed.label +
        " (" +
        ed.priceLabel +
        ")\r\n";
      if (rawEmail) body += "My email: " + rawEmail + "\r\n";
      body +=
        "\r\nShipping name & address:\r\n\r\n\r\n" +
        "Thanks!\r\n";

      window.location.href =
        "mailto:" +
        encodeURIComponent(BOOK_DIRECT.contactEmail) +
        "?subject=" +
        encodeURIComponent(subject) +
        "&body=" +
        encodeURIComponent(body);
    });
  }

  // |---Newsletter hidden field helper---|
  function newsletterEnsureHidden(form, name, value) {
    var found = form.elements.namedItem(name);
    var el =
      found && found.nodeName === "INPUT"
        ? found
        : found && found.length
          ? found[0]
          : null;
    if (!el || el.nodeName !== "INPUT") {
      el = document.createElement("input");
      el.type = "hidden";
      el.name = name;
      form.appendChild(el);
    }
    el.value = value;
  }

  // |---Newsletter form submit---|
  function initNewsletter() {
    var form = document.getElementById("newsletter-form");
    var status = document.getElementById("newsletter-status");
    if (!form || !status) return;

    var action = (NEWSLETTER.formAction || "").trim();
    if (!action) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        status.textContent =
          "This form is not connected yet. Open script.js, find NEWSLETTER, and set formAction to your Formspree (or other) form URL.";
        status.classList.remove("is-success");
        status.classList.add("is-error");
      });
      return;
    }

    form.setAttribute("action", action);
    form.setAttribute("method", "POST");
    var subj = (NEWSLETTER.ownerEmailSubject || "").trim();
    if (subj) newsletterEnsureHidden(form, "_subject", subj);

    if (!NEWSLETTER.stayOnPage) return;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      status.classList.remove("is-error", "is-success");
      status.textContent = "";

      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;

      var fd = new FormData(form);
      fetch(action, {
        method: "POST",
        body: fd,
        headers: { Accept: "application/json" },
      })
        .then(function (res) {
          if (res.ok) {
            form.reset();
            status.textContent = "Thanks! You’re on the list — watch your inbox.";
            status.classList.add("is-success");
            return;
          }
          return res.json().then(function (data) {
            var msg =
              data && (data.error || (data.errors && data.errors[0] && data.errors[0].message));
            throw new Error(msg || "Request failed");
          });
        })
        .catch(function () {
          status.textContent =
            "We couldn’t save your email. Try again in a moment, or use the contact link in the footer.";
          status.classList.add("is-error");
        })
        .then(function () {
          if (btn) btn.disabled = false;
        });
    });
  }

  // |---Footer year and mobile nav---|
  var nav = document.getElementById("site-nav");
  var toggle = document.querySelector(".nav-toggle");
  var yearEl = document.getElementById("year");

  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });

    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
      });
    });
  }

  initBookTrailer();
  initRetailPayPal();
  initBuyDirect();
  initNewsletter();
})();
