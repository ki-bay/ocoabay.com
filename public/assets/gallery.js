/* OcoaBay product gallery lightbox + zoom. Scoped to product imagery so it never
   hijacks logos/nav. Click a product image → fullscreen overlay; thumbnails switch. */
(function () {
  "use strict";
  var sel = ".woocommerce-product-gallery img, .single-product .wp-post-image, [data-ocoa-zoom] img, figure.wp-block-image img.wp-image-" ;
  var imgs = Array.prototype.slice.call(document.querySelectorAll(".woocommerce-product-gallery img, .single-product .wp-post-image, [data-ocoa-zoom] img"));
  if (!imgs.length) return;

  var ov = document.createElement("div");
  ov.id = "ocoa-lightbox";
  ov.innerHTML = '<button class="lb-x" aria-label="Close">×</button><button class="lb-prev" aria-label="Previous">‹</button><img><button class="lb-next" aria-label="Next">›</button>';
  document.body.appendChild(ov);
  var big = ov.querySelector("img");
  var idx = 0;
  var sources = imgs.map(function (i) { return i.getAttribute("data-large_image") || i.currentSrc || i.src; });

  function open(i) { idx = (i + sources.length) % sources.length; big.src = sources[idx]; ov.classList.add("open"); }
  function close() { ov.classList.remove("open"); }
  imgs.forEach(function (im, i) { im.style.cursor = "zoom-in"; im.addEventListener("click", function (e) { e.preventDefault(); open(i); }); });
  ov.querySelector(".lb-x").addEventListener("click", close);
  ov.querySelector(".lb-prev").addEventListener("click", function (e) { e.stopPropagation(); open(idx - 1); });
  ov.querySelector(".lb-next").addEventListener("click", function (e) { e.stopPropagation(); open(idx + 1); });
  ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
  document.addEventListener("keydown", function (e) {
    if (!ov.classList.contains("open")) return;
    if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") open(idx - 1); else if (e.key === "ArrowRight") open(idx + 1);
  });
})();
