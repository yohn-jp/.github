(() => {
  "use strict";

  const REVEAL_SELECTOR = '[data-motion="reveal"], .product-card';
  const STAGGER_SELECTOR = "[data-motion-stagger]";
  const STAGGER_STEP_MS = 60;
  const SCROLLED_THRESHOLD = 8;
  const GRAPH_EDGE_DELAY_MS = 220;
  const GRAPH_NODE_DELAY_MS = 420;
  let root;
  let observer;

  function prefersReducedMotion() {
    return Boolean(
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    );
  }

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
    const targets = [...document.querySelectorAll(REVEAL_SELECTOR)];

    if (
      prefersReducedMotion() ||
      !("IntersectionObserver" in window) ||
      !targets.length
    )
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

  function clearGraphMotion(svg, detail, timers = []) {
    timers.forEach((timer) => window.clearTimeout(timer));
    [svg, detail].forEach((element) => {
      element?.classList.remove(
        "graph-motion-ready",
        "graph-motion-edges-revealed",
        "graph-motion-nodes-revealed",
        "graph-detail-motion-ready",
        "graph-motion-detail-revealed"
      );
    });
  }

  function revealGraph({ svg, detail } = {}) {
    const edges = svg?.querySelectorAll(".graph-edge");
    const nodes = svg?.querySelectorAll(".graph-node");
    if (
      !svg ||
      !detail ||
      !edges?.length ||
      !nodes?.length ||
      prefersReducedMotion()
    ) {
      return false;
    }

    const timers = [];
    const failOpenGraph = () => clearGraphMotion(svg, detail, timers);
    const frame = window.requestAnimationFrame ?? ((callback) => callback());

    try {
      svg.classList.add("graph-motion-ready");
      detail.classList.add("graph-detail-motion-ready");
      frame(() => {
        try {
          svg.classList.add("graph-motion-edges-revealed");
          timers.push(
            window.setTimeout(() => {
              try {
                svg.classList.add("graph-motion-nodes-revealed");
                timers.push(
                  window.setTimeout(() => {
                    try {
                      detail.classList.add("graph-motion-detail-revealed");
                    } catch {
                      failOpenGraph();
                    }
                  }, GRAPH_NODE_DELAY_MS)
                );
              } catch {
                failOpenGraph();
              }
            }, GRAPH_EDGE_DELAY_MS)
          );
        } catch {
          failOpenGraph();
        }
      });
      return true;
    } catch {
      failOpenGraph();
      return false;
    }
  }

  try {
    root = document.documentElement;
    setupScrolledHeader();
    setupReveal();
  } catch {
    failOpen();
  }

  window.portalMotion = Object.freeze({ revealGraph });
})();
