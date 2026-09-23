
(function () {
  'use strict';

  document.querySelectorAll('[data-tisso-grid]').forEach(initGrid);

  function initGrid(gridEl) {
    var sectionEl = gridEl.closest('[id^="TissoGrid-"]');
    var sectionId = sectionEl.id.replace('TissoGrid-', '');
    var settings = (window.tissoVisionGridSettings || {})[sectionId] || {};

    var popup = document.querySelector('[data-tisso-popup]');
    if (!popup) {
      console.warn('Tisso Vision Grid: popup markup not found on page.');
      return;
    }

    var popupImage = popup.querySelector('[data-tisso-popup-image]');
    var popupTitle = popup.querySelector('[data-tisso-popup-title]');
    var popupPrice = popup.querySelector('[data-tisso-popup-price]');
    var popupDescription = popup.querySelector('[data-tisso-popup-description]');
    var popupOptions = popup.querySelector('[data-tisso-popup-options]');
    var popupForm = popup.querySelector('[data-tisso-popup-form]');
    var popupSubmit = popup.querySelector('[data-tisso-popup-submit]');
    var popupSubmitText = popup.querySelector('[data-tisso-submit-text]');
    var popupError = popup.querySelector('[data-tisso-popup-error]');

    // Current state for whichever product is open in the popup.
    var state = {
      product: null,
      selections: {} // { "Color": "Black", "Size": "Medium" }
    };

    // Tracks the currently-open dropdown list, once it's been moved
    // out into `popup` (see openDropdown) so it can't be clipped/
    // scrolled by the panel's own overflow. Only one can be open at a
    // time in this UI.
    var activeDropdown = null;

    /* ------------------------------------------------------------
       Open / close
       ------------------------------------------------------------ */

    gridEl.querySelectorAll('[data-tisso-open-popup]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var handle = btn.getAttribute('data-product-handle');
        var url = btn.getAttribute('data-product-url');

        setHotspotLoading(btn, true);

        fetchProduct(handle, url)
          .then(function (product) {
            if (!product || !Array.isArray(product.variants)) {
              throw new Error('Product data missing "variants" array.');
            }
            openPopup(product);
          })
          .catch(function (err) {
            console.error('Tisso Vision Grid: could not load product "' + handle + '".', err);
          })
          .finally(function () {
            setHotspotLoading(btn, false);
          });
      });
    });

    // Simple in-memory cache so re-opening the same product this
    // session doesn't re-fetch.
    var productCache = {};

    function fetchProduct(handle, url) {
      if (productCache[handle]) {
        return Promise.resolve(productCache[handle]);
      }

      // Primary path: Shopify's product AJAX endpoint. Always returns
      // complete, current data — this is what fixes the theme-editor
      // "variants undefined" bug, since it doesn't depend on a
      // script tag surviving the editor's live-preview re-render.
      var fetchUrl = (url || '/products/' + handle) + '.js';

      return fetch(fetchUrl)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (product) {
          product = normalizeProduct(product);
          productCache[handle] = product;
          return product;
        })
        .catch(function (fetchErr) {
          // Fallback: try the embedded JSON script tag, if present.
          var jsonEl = gridEl.querySelector('[data-tisso-product-json="' + handle + '"]');
          if (!jsonEl) throw fetchErr;
          try {
            var product = normalizeProduct(JSON.parse(jsonEl.textContent));
            productCache[handle] = product;
            return product;
          } catch (parseErr) {
            throw fetchErr;
          }
        });
    }

    // The AJAX endpoint (/products/handle.js) returns `options` as an
    // array of plain strings, e.g. ["Color", "Size"]. The Liquid
    // `{{ product | json }}` fallback instead returns `options` as an
    // array of objects, e.g. [{ name: "Color", values: [...] }, ...].
    // Every render/selection function below assumes plain strings, so
    // when the fallback path fires, an option "name" is actually an ASD
    // object — it stringifies to "[object Object]" as a label and as
    // a selections key, which breaks variant matching entirely (every
    // variant looks unavailable). Normalize once, right after fetch,  aD
    // so the rest of the code never has to care which path was used.
    function normalizeProduct(product) {
      if (product && Array.isArray(product.options) && product.options.length && typeof product.options[0] === 'object') {
        product.options = product.options.map(function (option) {
          return option && option.name ? option.name : String(option);
        });
      }
      return product;
    }

    function setHotspotLoading(btn, isLoading) {
      btn.disabled = isLoading;
      btn.classList.toggle('is-loading', isLoading);
    }

    popup.querySelectorAll('[data-tisso-popup-close]').forEach(function (el) {
      el.addEventListener('click', closePopup);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !popup.hasAttribute('hidden')) {
        closePopup();
      }
    });

    function openPopup(product) {
      state.product = product;
      state.selections = {};

      // Pre-select the first available variant's option values so the
      // popup opens in a valid, purchasable state.
      var firstAvailable = product.variants.find(function (v) { return v.available; }) || product.variants[0];
      if (firstAvailable) {
        product.options.forEach(function (optionName, index) {
          state.selections[optionName] = firstAvailable['option' + (index + 1)];
        });
      }

      renderPopup();
      popup.removeAttribute('hidden');
      document.body.style.overflow = 'hidden';
      popup.querySelector('.tisso-popup__panel').focus && popup.querySelector('.tisso-popup__panel').focus();
    }

    function closePopup() {
      popup.setAttribute('hidden', '');
      document.body.style.overflow = '';
      hideError();
    }

    /* ------------------------------------------------------------
       Rendering
       ------------------------------------------------------------ */

    function renderPopup() {
      var product = state.product;
      var variant = getSelectedVariant();

      popupTitle.textContent = product.title;
      popupDescription.textContent = stripHtml(product.description);

      var img = variant && variant.featured_image ? variant.featured_image.src : (product.featured_image || (product.images && product.images[0]));
      popupImage.src = img ? resizeImage(img, 800) : '';
      popupImage.alt = product.title;

      renderPrice(variant);
      renderOptions(product);
      renderAvailability(variant);
    }

    function renderPrice(variant) {
      var amount = variant ? variant.price : state.product.price;
      popupPrice.textContent = formatMoney(amount);
    }

    function renderOptions(product) {
      // If a dropdown was open, its list currently lives directly
      // under `popup` (see openDropdown), not inside popupOptions —
      // clean it up before wiping/rebuilding, or it'd be orphaned.
      if (activeDropdown) {
        if (activeDropdown.list.parentNode) {
          activeDropdown.list.parentNode.removeChild(activeDropdown.list);
        }
        activeDropdown = null;
      }
      popupOptions.innerHTML = '';

      // Always render Color/Colour first, then Size, then anything
      // else — regardless of the order Shopify happens to store the
      // product's options in. Array.sort is stable, so options with
      // the same rank (e.g. two "other" options) keep their original
      // relative order.
      var ordered = product.options.map(function (name, index) {
        return { name: name, index: index };
      }).sort(function (a, b) {
        return optionRank(a.name) - optionRank(b.name);
      });

      ordered.forEach(function (entry) {
        var optionName = entry.name;
        var index = entry.index;
        var values = collectValuesForOption(product, index);

        var wrapper = document.createElement('div');
        wrapper.className = 'tisso-popup__option';

        var label = document.createElement('label');
        label.className = 'tisso-popup__option-label';
        label.textContent = optionName;
        wrapper.appendChild(label);

        // Size is always shown as a dropdown, whatever the number of
        // values — that's the requested UX regardless of how many
        // sizes a given product has. Every other option (Color,
        // Frame Colour, etc.) stays as swatch-style buttons.
        if (optionName.toLowerCase() === 'size') {
          wrapper.appendChild(buildDropdown(product, optionName, values));
        } else {
          wrapper.appendChild(buildSwatches(product, optionName, index, values));
        }

        popupOptions.appendChild(wrapper);
      });
    }

    function optionRank(name) {
      var n = name.toLowerCase();
      if (n.indexOf('color') > -1 || n.indexOf('colour') > -1) return 0;
      if (n.indexOf('size') > -1) return 1;
      return 2;
    }

    // Custom inline dropdown: a trigger button showing the current
    // value (or a placeholder) with a chevron, and a list of choices
    // that expands directly below it in the flow of the page (not a
    // native <select>, so it can be styled/animated to match design).
    function buildDropdown(product, optionName, values) {
      var wrapper = document.createElement('div');
      wrapper.className = 'tisso-popup__dropdown';

      var trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'tisso-popup__dropdown-trigger';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('data-option-name', optionName);

      var triggerText = document.createElement('span');
      triggerText.className = 'tisso-popup__dropdown-trigger-text';
      triggerText.textContent = state.selections[optionName] || ('Choose your ' + optionName.toLowerCase());
      trigger.appendChild(triggerText);

      var chevron = document.createElement('span');
      chevron.className = 'tisso-popup__dropdown-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      trigger.appendChild(chevron);

      var list = document.createElement('div');
      list.className = 'tisso-popup__dropdown-list';
      list.hidden = true;

      values.forEach(function (value) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'tisso-popup__dropdown-item';
        item.textContent = value;

        var wouldBeAvailable = isCombinationAvailable(product, optionName, value);
        item.disabled = !wouldBeAvailable;
        if (state.selections[optionName] === value) item.classList.add('is-selected');

        item.addEventListener('click', function () {
          state.selections[optionName] = value;
          renderPopup();
        });

        list.appendChild(item);
      });

      trigger.addEventListener('click', function (event) {
        event.stopPropagation();
        var isOpen = trigger.getAttribute('aria-expanded') === 'true';
        closeAllDropdowns();
        if (!isOpen) openDropdown(list, trigger);
      });

      wrapper.appendChild(trigger);
      wrapper.appendChild(list);
      return wrapper;
    }

    function openDropdown(list, trigger) {
      // Move the list out of the (scrollable) popup panel and
      // position it with fixed coordinates over the trigger, so it
      // floats above everything without ever becoming part of the
      // panel's own scrollable content — that's what keeps the
      // popup's scrollbar (if any) totally unaffected by the dropdown
      // being open, and its own scroll strictly internal to itself.
      var rect = trigger.getBoundingClientRect();
      list.style.position = 'fixed';
      list.style.top = rect.bottom + 'px';
      list.style.left = rect.left + 'px';
      list.style.width = rect.width + 'px';
      popup.appendChild(list);

      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      activeDropdown = { list: list, trigger: trigger };

      // Add the open class on the next frame so the opacity/transform
      // transition actually runs instead of jumping straight to it.
      requestAnimationFrame(function () {
        list.classList.add('is-open');
      });
    }

    function closeDropdown(list, trigger) {
      list.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      setTimeout(function () {
        if (!list.classList.contains('is-open')) list.hidden = true;
      }, 160);
    }

    function closeAllDropdowns() {
      if (activeDropdown) {
        closeDropdown(activeDropdown.list, activeDropdown.trigger);
        activeDropdown = null;
      }
    }

    // Clicking anywhere outside an open dropdown closes it — same
    // expectation as a native <select>. The list itself now lives
    // outside popupOptions while open (see openDropdown), so it has
    // to be checked separately here.
    document.addEventListener('click', function (event) {
      var insideOptions = popupOptions.contains(event.target);
      var insideActiveList = activeDropdown && activeDropdown.list.contains(event.target);
      if (!insideOptions && !insideActiveList) closeAllDropdowns();
    });

    function buildSwatches(product, optionName, optionIndex, values) {
      var container = document.createElement('div');
      container.className = 'tisso-popup__option-values';
      // Any "Color"/"Colour"-type option (not just literal CSS color
      // names) gets a left accent border in its own color when
      // selected — never the generic solid-black fill.
      var isColorOption = /colou?r/i.test(optionName);

      values.forEach(function (value) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'tisso-popup__option-value';
        button.textContent = value;
        button.setAttribute('aria-pressed', state.selections[optionName] === value ? 'true' : 'false');

        if (isColorOption) {
          button.classList.add('tisso-popup__option-value--hue');
          button.style.setProperty('--swatch-accent', resolveSwatchAccent(value));
        }

        var wouldBeAvailable = isCombinationAvailable(product, optionName, value);
        button.disabled = !wouldBeAvailable;

        button.addEventListener('click', function () {
          state.selections[optionName] = value;
          renderPopup();
        });

        container.appendChild(button);
      });

      return container;
    }

    // Best-effort mapping from a color option's value to an actual CSS
    // color, so its selected state can show that exact color as a
    // left accent border. Real color names (e.g. "Blue", "Black")
    // work directly; common merchandising names that aren't valid CSS
    // keywords (e.g. "Golden", "Walnut") go through a small alias
    // table; anything still unrecognized falls back to a neutral gray
    // border so every color swatch gets *some* accent, never a plain
    // black fill.
    var SWATCH_COLOR_ALIASES = {
      golden: 'gold', walnut: 'saddlebrown', rosegold: '#b76e79',
      charcoal: '#333333', copper: '#b87333', bronze: '#8c7853',
      natural: '#deb887', champagne: '#f7e7ce', ivory: '#fffff0'
    };

    function resolveSwatchAccent(value) {
      if (isCssColorName(value)) {
        var lower = value.toLowerCase();
        // A white (or near-white) border is invisible against the
        // swatch's own white background — use a visible light-gray
        // outline instead so the accent still reads.
        return (lower === 'white' || lower === '#fff' || lower === '#ffffff') ? '#ccc' : lower;
      }
      var key = value.toLowerCase().replace(/[^a-z]/g, '');
      return SWATCH_COLOR_ALIASES[key] || '#999';
    }

    function isCssColorName(value) {
      try {
        return !!(window.CSS && CSS.supports && CSS.supports('color', value));
      } catch (e) {
        return false;
      }
    }

    // Returns true if there exists at least one variant matching the
    // current selections with this option swapped to `value`.
    function isCombinationAvailable(product, optionName, value) {
      var trialSelections = Object.assign({}, state.selections);
      trialSelections[optionName] = value;

      return product.variants.some(function (variant) {
        return product.options.every(function (name, i) {
          return variant['option' + (i + 1)] === trialSelections[name];
        }) && variant.available;
      });
    }

    function collectValuesForOption(product, optionIndex) {
      var seen = [];
      product.variants.forEach(function (variant) {
        var value = variant['option' + (optionIndex + 1)];
        if (value && seen.indexOf(value) === -1) seen.push(value);
      });
      return seen;
    }

    function renderAvailability(variant) {
      var available = !!(variant && variant.available);
      popupSubmit.disabled = !available;
      popupSubmitText.textContent = !variant
        ? 'Unavailable'
        : available
          ? 'ADD TO CART'
          : 'Sold out';
    }

    function getSelectedVariant() {
      var product = state.product;
      if (!product) return null;
      return product.variants.find(function (variant) {
        return product.options.every(function (name, i) {
          return variant['option' + (i + 1)] === state.selections[name];
        });
      }) || null;
    }

    /* ------------------------------------------------------------
       Add to cart
       ------------------------------------------------------------ */

    popupForm.addEventListener('submit', function (event) {
      event.preventDefault();
      hideError();

      var variant = getSelectedVariant();
      if (!variant || !variant.available) {
        showError('This combination is currently unavailable.');
        return;
      }

      setLoading(true);

      addToCart(variant.id, 1)
        .then(function () {
          if (shouldAutoAdd(variant)) {
            return addAutoAddProduct();
          }
        })
        .then(function () {
          setLoading(false);
          showAddedFeedback();
          notifyCartUpdated();
          // Give the shopper a beat to see the confirmation before the
          // popup disappears, instead of it just vanishing silently.
          setTimeout(closePopup, 700);
        })
        .catch(function (err) {
          console.error('Tisso Vision Grid: add to cart failed', err);
          setLoading(false);
          showError('Something went wrong adding this item. Please try again.');
        });
    });

    function showAddedFeedback() {
      popupSubmitText.textContent = 'Added to cart \u2713';
    }

    function shouldAutoAdd(variant) {
      var trigger = settings.autoAddTrigger;
      if (!trigger || !trigger.productHandle) return false;

      var variantValues = state.product.options.map(function (name) {
        return state.selections[name];
      });

      // Trigger fires when the chosen variant includes BOTH configured
      // values (order-independent), e.g. Color=Black and Size=Medium.
      return trigger.optionValues.every(function (required) {
        return variantValues.indexOf(required) !== -1;
      });
    }

    function addAutoAddProduct() {
      var handle = settings.autoAddTrigger.productHandle;
      return fetch('/products/' + handle + '.js')
        .then(function (res) {
          if (!res.ok) throw new Error('Auto-add product fetch failed');
          return res.json();
        })
        .then(function (autoProduct) {
          var firstAvailable = autoProduct.variants.find(function (v) { return v.available; });
          if (!firstAvailable) return; // nothing sellable to add; fail silently
          return addToCart(firstAvailable.id, 1);
        });
    }

    function addToCart(variantId, quantity) {
      return fetch(settings.cartAddUrl || '/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: variantId, quantity: quantity })
      }).then(function (res) {
        if (!res.ok) {
          return res.json().then(function (body) {
            throw new Error(body.description || 'Add to cart failed');
          });
        }
        return res.json();
      });
    }

    /* ------------------------------------------------------------
       Misc helpers
       ------------------------------------------------------------ */

    function setLoading(isLoading) {
      popupSubmit.disabled = isLoading;
      popupSubmit.setAttribute('data-loading', isLoading ? 'true' : 'false');
    }

    function showError(message) {
      popupError.textContent = message;
      popupError.removeAttribute('hidden');
    }

    function hideError() {
      popupError.textContent = '';
      popupError.setAttribute('hidden', '');
    }

    function stripHtml(html) {
      var tmp = document.createElement('div');
      tmp.innerHTML = html || '';
      return tmp.textContent || tmp.innerText || '';
    }

    function resizeImage(url, size) {
      // Shopify CDN width param; falls back gracefully if already sized.
      if (!url) return '';
      return url.replace(/(\.[a-zA-Z0-9]+)(\?|$)/, '_' + size + 'x$1$2');
    }

    function formatMoney(cents) {
      var amount = (cents / 100).toFixed(2);
      var format = settings.moneyFormat || '${{amount}}';
      return format.replace(/\{\{\s*amount\s*\}\}/, amount);
    }

    function notifyCartUpdated() {
      // Let the rest of the theme (cart drawer/bubble) know the cart
      // changed, without depending on any specific theme's internals.
      document.dispatchEvent(new CustomEvent('cart:updated'));

      // Dawn's own header cart-icon count is a server-rendered section
      // that only refreshes on a full page load — it doesn't listen for
      // a generic "cart:updated" event. Pull the latest markup for that
      // section via Shopify's Section Rendering API and swap it in, so
      // the count bumps immediately. This silently no-ops on any theme
      // that doesn't have a "cart-icon-bubble" section/id (i.e. it's
      // safe on non-Dawn themes too).
      fetch('/?sections=cart-icon-bubble')
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (!data || !data['cart-icon-bubble']) return;
          var bubbleHost = document.getElementById('cart-icon-bubble');
          if (bubbleHost) bubbleHost.innerHTML = data['cart-icon-bubble'];
        })
        .catch(function () { /* not Dawn, or section renamed — ignore */ });
    }
  }
})();
