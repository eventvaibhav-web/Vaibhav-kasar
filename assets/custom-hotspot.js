document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('CustomHotspotDialog');
  const closeBtn = dialog?.querySelector('.js-popup-close');
  const form = document.getElementById('PopupForm');
  const submitBtn = document.getElementById('PopupSubmit');
  const msgContainer = document.getElementById('PopupMessage');
  
  if (!dialog) return;

  let currentProduct = null;
  let selectedOptions = [];

  // --- POPUP OPEN / CLOSE LOGIC ---
  
  document.querySelectorAll('.js-hotspot-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const handle = e.currentTarget.getAttribute('data-product-handle');
      const scriptTag = document.querySelector(`script[data-hotspot-json="${handle}"]`);
      
      if (scriptTag) {
        try {
          currentProduct = JSON.parse(scriptTag.textContent);
          populatePopup(currentProduct);
          dialog.showModal();
        } catch (err) {
          console.error("Error parsing product JSON", err);
        }
      }
    });
  });

  closeBtn.addEventListener('click', () => dialog.close());

  // Close on backdrop click
  dialog.addEventListener('click', (e) => {
    const rect = dialog.getBoundingClientRect();
    const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
                        rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
    if (!isInDialog) dialog.close();
  });

  // --- UI POPULATION LOGIC ---

  function populatePopup(product) {
    document.getElementById('PopupImg').src = product.image;
    document.getElementById('PopupTitle').textContent = product.title;
    document.getElementById('PopupDesc').textContent = product.description;
    
    msgContainer.textContent = '';
    msgContainer.className = 'custom-popup__msg';

    // Default: select the first available variant options
    const firstAvailable = product.variants.find(v => v.available) || product.variants[0];
    selectedOptions = [firstAvailable.option1, firstAvailable.option2, firstAvailable.option3].filter(Boolean);

    renderOptions(product);
    updateVariantState();
  }

  function renderOptions(product) {
    const optionsContainer = document.getElementById('PopupOptions');
    optionsContainer.innerHTML = '';

    product.options.forEach((opt, index) => {
      // Shopify's format: opt.name is the string, opt.values is an array
      const optName = opt.name.toLowerCase();
      const optionEl = document.createElement('div');
      optionEl.className = 'custom-popup__option-group';
      
      const label = document.createElement('label');
      label.className = 'custom-popup__option-label';
      label.textContent = opt.name;
      optionEl.appendChild(label);

      // Render as Pills if option is "Color" (or colour), else Dropdown
      if (optName.includes('color') || optName.includes('colour')) {
        const pillsWrap = document.createElement('div');
        pillsWrap.className = 'custom-popup__pills';
        
        opt.values.forEach(val => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `custom-popup__pill ${selectedOptions[index] === val ? 'is-active' : ''}`;
          btn.textContent = val;
          btn.addEventListener('click', () => handleOptionChange(index, val));
          pillsWrap.appendChild(btn);
        });
        optionEl.appendChild(pillsWrap);
      } else {
        const select = document.createElement('select');
        select.className = 'custom-popup__select';
        
        opt.values.forEach(val => {
          const option = document.createElement('option');
          option.value = val;
          option.textContent = val;
          if (selectedOptions[index] === val) option.selected = true;
          select.appendChild(option);
        });
        
        select.addEventListener('change', (e) => handleOptionChange(index, e.target.value));
        optionEl.appendChild(select);
      }

      optionsContainer.appendChild(optionEl);
    });
  }

  function handleOptionChange(index, value) {
    selectedOptions[index] = value;
    renderOptions(currentProduct); // re-render to update active classes
    updateVariantState();
  }

  function updateVariantState() {
    const variant = currentProduct.variants.find(v => {
      const match1 = !selectedOptions[0] || v.option1 === selectedOptions[0];
      const match2 = !selectedOptions[1] || v.option2 === selectedOptions[1];
      const match3 = !selectedOptions[2] || v.option3 === selectedOptions[2];
      return match1 && match2 && match3;
    });

    const priceEl = document.getElementById('PopupPrice');
    const variantInput = document.getElementById('PopupVariantId');

    if (variant) {
      priceEl.textContent = formatMoney(variant.price);
      variantInput.value = variant.id;
      
      if (variant.available) {
        submitBtn.disabled = false;
        submitBtn.querySelector('span').textContent = 'ADD TO CART';
      } else {
        submitBtn.disabled = true;
        submitBtn.querySelector('span').textContent = 'SOLD OUT';
      }
    } else {
      priceEl.textContent = 'Unavailable';
      variantInput.value = '';
      submitBtn.disabled = true;
      submitBtn.querySelector('span').textContent = 'UNAVAILABLE';
    }
  }

  function formatMoney(cents) {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'EUR' });
  }

  // --- AJAX CART & BUSINESS RULE LOGIC ---

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.querySelector('span').textContent = 'ADDING...';
    msgContainer.textContent = '';
    
    const variantId = document.getElementById('PopupVariantId').value;
    
    // Check for the "Black + Medium" condition
    const isBlack = selectedOptions.some(opt => opt && opt.toLowerCase() === 'black');
    const isMedium = selectedOptions.some(opt => opt && opt.toLowerCase() === 'medium');
    
    let itemsToAdd = [{ id: parseInt(variantId), quantity: 1 }];

    try {
      // Special Rule Trigger
      if (isBlack && isMedium) {
        // 1. Fetch cart to see if jacket is already there
        const cartRes = await fetch(window.Shopify.routes.root + 'cart.js');
        const cart = await cartRes.json();
        const hasJacket = cart.items.some(item => item.handle === 'soft-winter-jacket');

        // 2. Fetch the jacket product if not in cart
        if (!hasJacket) {
          const jacketRes = await fetch('/products/soft-winter-jacket.js');
          if (jacketRes.ok) {
            const jacketData = await jacketRes.json();
            // Get first available variant
            const jacketVariant = jacketData.variants.find(v => v.available);
            if (jacketVariant) {
              itemsToAdd.push({ id: jacketVariant.id, quantity: 1 });
            }
          }
        }
      }

      // 3. Add to cart
      const addRes = await fetch(window.Shopify.routes.root + 'cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsToAdd })
      });

      if (!addRes.ok) throw new Error('Failed to add to cart');

      // Success
      msgContainer.textContent = 'Successfully added to cart!';
      msgContainer.className = 'custom-popup__msg custom-popup__msg--success';
      
      // Update typical Shopify themes mini-cart/header if events are observed globally
      document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));

    } catch (error) {
      console.error(error);
      msgContainer.textContent = 'An error occurred. Please try again.';
      msgContainer.className = 'custom-popup__msg custom-popup__msg--error';
    } finally {
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = 'ADD TO CART';
    }
  });
});