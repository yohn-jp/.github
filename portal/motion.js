(() => {
  "use strict";

  const REVEAL_SELECTOR = '[data-motion="reveal"], .product-card';
  const STAGGER_SELECTOR = "[data-motion-stagger]";
  const STAGGER_STEP_MS = 60;
  const SCROLLED_THRESHOLD = 8;
  let root;
  let observer;

  function failOpen() {
    root?.classList.remove("motion-ready");
    observer?.disconnect();

    document.querySelectorAll(REVEAL_SELECTOR).forEach((element) => {
      element.classList.add("motion-revealed");
      element.style.removeProperty("transition-delay");
    });
  }

  function setupScrolledHeader() {
    const headers = [...document.querySelectorAll(".site-nav-wrap")];
    const update = () => {
      const scrolled = window.scrollY > SCROLLED_THRESHOLD;
      headers.forEach((header) => {
        header.classList.toggle("is-scrolled", scrolled);
      });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  function setupStagger() {
    document.querySelectorAll(STAGGER_SELECTOR).forEach((container) => {
      [...container.children]
        .filter((element) => element.matches(REVEAL_SELECTOR))
        .forEach((element, index) => {
          element.style.transitionDelay = `${index * STAGGER_STEP_MS}ms`;
        });
    });
  }

  function setupReveal() {
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const targets = [...document.querySelectorAll(REVEAL_SELECTOR)];

    if (reducedMotion || !("IntersectionObserver" in window) || !targets.length)
      return;

    setupStagger();
    observer = new IntersectionObserver(
      (entries) => {
        try {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("motion-revealed");
            observer.unobserve(entry.target);
          });
        } catch {
          failOpen();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 }
    );

    root.classList.add("motion-ready");
    targets.forEach((target) => observer.observe(target));
  }

  try {
    root = document.documentElement;
    setupScrolledHeader();
    setupReveal();
  } catch {
    failOpen();
  }
})();
