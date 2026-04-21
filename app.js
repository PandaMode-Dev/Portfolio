(function () {
  const rocket = document.getElementById("rocket");
  const yearEl = document.getElementById("year");
  const iconStack = document.getElementById("ship-icon-stack");

  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const ROCKET_SCROLL_GAIN = 2.15;
  const ROCKET_START_VH = 0.88;
  const ROCKET_END_OFFSET = 18;
  const ROCKET_SWAY_PX = 10;
  const ROCKET_TILT_DEG = 10;
  const ROCKET_SCALE_BOOST = 0.14;

  // |---Rocket ship icon badges---|
  function renderShipIcons() {
    if (!iconStack) return;
    const items = window.resumeShipIcons;
    if (!Array.isArray(items) || items.length === 0) return;
    iconStack.innerHTML = "";
    items.forEach(function (item) {
      const wrap = document.createElement("div");
      wrap.className = "ship-icon tech-badge";
      wrap.title = item.title || "";

      if (item.kind === "image" && item.src) {
        const img = document.createElement("img");
        img.src = item.src;
        img.alt = item.title || "";
        img.loading = "lazy";
        wrap.appendChild(img);
      } else if (item.kind === "svg" && item.html) {
        wrap.innerHTML = item.html;
        const svg = wrap.querySelector("svg");
        if (svg) {
          svg.setAttribute("aria-hidden", "true");
          svg.style.width = "1.2rem";
          svg.style.height = "1.2rem";
          svg.style.display = "block";
        }
      } else if (item.kind === "text" && item.value) {
        wrap.classList.add("ship-icon-text");
        wrap.textContent = item.value;
      } else {
        wrap.classList.add("ship-icon-emoji");
        wrap.textContent = item.value || "·";
      }

      iconStack.appendChild(wrap);
    });
  }

  renderShipIcons();

  const reduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced) {
    document.body.classList.add("motion-reduced");
  }

  let ticking = false;

  // |---Scroll progress and rocket motion---|
  function scrollProgress() {
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    const p = scrollTop / max;
    return Math.min(1, Math.max(0, p));
  }

  function updateRocket() {
    const pRaw = scrollProgress();
    const bar = document.getElementById("scroll-progress");
    if (bar) bar.style.transform = `scaleX(${pRaw})`;

    if (!rocket) {
      ticking = false;
      return;
    }
    const p = reduced ? 0 : Math.min(1, pRaw * ROCKET_SCROLL_GAIN);
    const vh = window.innerHeight;
    const headerEl = document.querySelector(".site-header");
    const headerPx = headerEl ? headerEl.offsetHeight : 68;
    const start = vh * ROCKET_START_VH;
    const end = headerPx + ROCKET_END_OFFSET;
    const y = start - (start - end) * p;
    const sway = reduced ? 0 : Math.sin(pRaw * Math.PI * 2.5) * ROCKET_SWAY_PX;
    const tilt = reduced ? -2 : -3 + p * ROCKET_TILT_DEG;
    const scale = reduced ? 1 : 1 + p * ROCKET_SCALE_BOOST;
    rocket.style.transform = `translate3d(${sway}px, -${y}px, 0) rotate(${tilt}deg) scale(${scale})`;
    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateRocket);
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  updateRocket();

  // |---Section reveal on scroll---|
  if (!reduced) {
    const revealEls = document.querySelectorAll("[data-reveal]");
    if (revealEls.length && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) e.target.classList.add("is-visible");
          });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
      );
      revealEls.forEach(function (el) {
        io.observe(el);
      });
    } else {
      revealEls.forEach(function (el) {
        el.classList.add("is-visible");
      });
    }
  } else {
    document.querySelectorAll("[data-reveal]").forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  // |---Nav highlight for current section---|
  const navLinks = document.querySelectorAll(".nav a[href^='#']");
  const sectionIds = [];
  navLinks.forEach(function (a) {
    const id = a.getAttribute("href");
    if (id && id.length > 1) sectionIds.push(id.slice(1));
  });

  function updateActiveNav() {
    const mid = window.scrollY + window.innerHeight * 0.28;
    let current = "";
    sectionIds.forEach(function (sid) {
      const sec = document.getElementById(sid);
      if (!sec) return;
      const top = sec.offsetTop;
      if (mid >= top) current = sid;
    });
    navLinks.forEach(function (a) {
      const href = a.getAttribute("href");
      const id = href && href.slice(1);
      a.classList.toggle("is-active", id === current && current !== "");
    });
  }

  let navTick = false;
  function onScrollNav() {
    if (!navTick) {
      navTick = true;
      requestAnimationFrame(function () {
        updateActiveNav();
        navTick = false;
      });
    }
  }
  window.addEventListener("scroll", onScrollNav, { passive: true });
  updateActiveNav();

  // |---Websites dropdown menu---|
  const navDropdown = document.querySelector("[data-nav-dropdown]");
  if (navDropdown) {
    const trigger = navDropdown.querySelector(".nav-dropdown-trigger");
    const panel = navDropdown.querySelector(".nav-dropdown-panel");
    const links = panel ? panel.querySelectorAll(".nav-dropdown-link") : [];

    function setOpen(open) {
      navDropdown.classList.toggle("is-open", open);
      if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (panel) panel.hidden = !open;
    }

    function isOpen() {
      return navDropdown.classList.contains("is-open");
    }

    if (trigger && panel) {
      trigger.addEventListener("click", function (e) {
        e.preventDefault();
        setOpen(!isOpen());
      });

      document.addEventListener("click", function (e) {
        if (!navDropdown.contains(e.target) && isOpen()) {
          setOpen(false);
        }
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && isOpen()) {
          setOpen(false);
          trigger.focus();
        }
      });

      links.forEach(function (link) {
        link.addEventListener("click", function () {
          setOpen(false);
        });
      });
    }
  }

  // |---Pointer tilt on project cards---|
  if (!reduced) {
    document.querySelectorAll("[data-tilt]").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty("--tilt-x", String(x * 8));
        card.style.setProperty("--tilt-y", String(-y * 8));
      });
      card.addEventListener("pointerleave", function () {
        card.style.setProperty("--tilt-x", "0");
        card.style.setProperty("--tilt-y", "0");
      });
    });
  }
})();
