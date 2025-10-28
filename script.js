// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Global state
let currentMenu = {
    name: '',
    pdfText: '',
    sections: []
};

let menuDatabase = [];
let currentOrder = {
    menuId: null,
    selections: {},
    dietaryPreferences: [],
    allergens: '',
    additionalNotes: ''
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    loadMenuDatabase();
});

function initializeApp() {
    // Load menus from localStorage
    const savedMenus = localStorage.getItem('menuDatabase');
    if (savedMenus) {
        menuDatabase = JSON.parse(savedMenus);
        updateMenuList();
    }
}

function setupEventListeners() {
    // Mode switching
    document.getElementById('chef-mode-btn').addEventListener('click', () => switchMode('chef'));
    document.getElementById('guest-mode-btn').addEventListener('click', () => switchMode('guest'));

    // Chef interface
    document.getElementById('pdf-upload').addEventListener('change', handlePDFUpload);
    document.getElementById('add-section-btn').addEventListener('click', addSection);
    document.getElementById('save-menu-btn').addEventListener('click', saveMenu);

    // Guest interface
    document.getElementById('menu-list').addEventListener('change', loadSelectedMenu);
    document.getElementById('submit-order-btn').addEventListener('click', submitOrder);

    // Dietary preferences
    document.querySelectorAll('#guest-interface input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', updateOrderSummary);
    });
    document.getElementById('allergens').addEventListener('input', updateOrderSummary);
    document.getElementById('additional-notes').addEventListener('input', updateOrderSummary);
}

function switchMode(mode) {
    const chefBtn = document.getElementById('chef-mode-btn');
    const guestBtn = document.getElementById('guest-mode-btn');
    const chefInterface = document.getElementById('chef-interface');
    const guestInterface = document.getElementById('guest-interface');

    if (mode === 'chef') {
        chefBtn.classList.add('active');
        guestBtn.classList.remove('active');
        chefInterface.classList.add('active');
        guestInterface.classList.remove('active');
    } else {
        guestBtn.classList.add('active');
        chefBtn.classList.remove('active');
        guestInterface.classList.add('active');
        chefInterface.classList.remove('active');
    }
}

// ==================== CHEF INTERFACE ====================

function parseMenuFromText(lines) {
    const sections = [];

    // Common menu section keywords
    const sectionKeywords = [
        'appetizer', 'starter', 'beginning', 'small plate', 'antipasti',
        'salad', 'soup', 'entree', 'entrée', 'main', 'course', 'pasta',
        'seafood', 'meat', 'poultry', 'beef', 'chicken', 'fish',
        'vegetarian', 'vegan', 'side', 'dessert', 'sweet', 'drink',
        'beverage', 'cocktail', 'wine', 'beer', 'breakfast', 'lunch', 'dinner',
        'brunch', 'pizza', 'sandwich', 'burger', 'taco', 'sushi', 'roll'
    ];

    let currentSection = null;
    let potentialItems = [];

    // Filter out very short lines and common non-menu text
    const filteredLines = lines.filter(line => {
        const lower = line.toLowerCase();
        if (line.length < 2) return false;
        if (/^page \d+/i.test(line)) return false;
        if (/^(menu|www\.|http)/i.test(line)) return false;
        return true;
    });

    for (let i = 0; i < filteredLines.length; i++) {
        const line = filteredLines[i].trim();
        if (!line) continue;

        const nextLine = i < filteredLines.length - 1 ? filteredLines[i + 1].trim() : '';

        // Check if this line is likely a section header
        const isSectionHeader = isSectionHeaderLine(line, nextLine, sectionKeywords);

        if (isSectionHeader) {
            // Save previous section if it exists
            if (currentSection && potentialItems.length > 0) {
                currentSection.items = cleanMenuItems(potentialItems);
                if (currentSection.items.length > 0) {
                    sections.push(currentSection);
                }
            }

            // Start new section
            currentSection = {
                id: Date.now() + Math.random(),
                name: cleanSectionName(line),
                maxSelections: 1,
                items: []
            };
            potentialItems = [];
        } else if (currentSection) {
            // This might be a menu item
            const item = extractMenuItem(line);
            if (item && item.length > 0) {
                potentialItems.push(item);
            }
        }
    }

    // Save the last section
    if (currentSection && potentialItems.length > 0) {
        currentSection.items = cleanMenuItems(potentialItems);
        if (currentSection.items.length > 0) {
            sections.push(currentSection);
        }
    }

    // Set reasonable max selections based on section size
    sections.forEach(section => {
        if (section.items.length <= 3) {
            section.maxSelections = 1;
        } else if (section.items.length <= 6) {
            section.maxSelections = 2;
        } else {
            section.maxSelections = 3;
        }
    });

    console.log('Parsed sections:', sections);
    return sections;
}

function isSectionHeaderLine(line, nextLine, sectionKeywords) {
    // Section headers are typically:
    // 1. Short (less than 50 characters)
    // 2. All caps or title case
    // 3. Contain menu section keywords
    // 4. Don't contain prices
    // 5. Not followed by a description or price on the same line

    if (line.length > 50) return false;

    const lower = line.toLowerCase();

    // Check if it contains section keywords
    const hasKeyword = sectionKeywords.some(keyword => lower.includes(keyword));

    // Check if all caps or mostly caps
    const capsRatio = (line.match(/[A-Z]/g) || []).length / line.replace(/[^a-zA-Z]/g, '').length;
    const isAllCaps = capsRatio > 0.7;

    // Check if it's title case (first letter of each word capitalized)
    const words = line.split(/\s+/);
    const isTitleCase = words.length > 0 && words.every(word =>
        word.length === 0 || /^[A-Z]/.test(word) || /^[^a-zA-Z]/.test(word)
    );

    // Shouldn't contain a price symbol prominently
    const hasPrice = /\$\d+|\d+\.\d{2}/.test(line);

    // Check if next line looks like an item (has price or description)
    const nextLooksLikeItem = nextLine && (/\$\d+/.test(nextLine) || nextLine.length > 50);

    return (hasKeyword || isAllCaps || isTitleCase) && !hasPrice;
}

function cleanSectionName(line) {
    // Remove extra characters and clean up the section name
    return line
        .replace(/[_\-=]{3,}/g, '') // Remove separator lines
        .replace(/^\W+|\W+$/g, '')   // Remove leading/trailing non-word chars
        .trim();
}

function extractMenuItem(line) {
    // Extract the menu item name (remove prices and excessive descriptions)

    // Remove price patterns
    let item = line.replace(/\$\s*\d+(\.\d{2})?/g, '');
    item = item.replace(/\d+\.\d{2}\s*$/g, '');
    item = item.replace(/\.\s*\.\s*\./g, ''); // Remove dot leaders

    // If the line is very long, it might be a description - try to get just the item name
    if (item.length > 80) {
        // Take first sentence or first part before a dash/comma
        const parts = item.split(/[.—–\-]{2,}|,/);
        item = parts[0].trim();
    }

    // Remove common prefixes
    item = item.replace(/^[-•*]\s*/, '');

    // Remove excessive whitespace
    item = item.replace(/\s+/g, ' ').trim();

    return item;
}

function cleanMenuItems(items) {
    // Filter and clean menu items
    return items
        .filter(item => {
            if (!item || item.length < 3) return false;
            // Filter out lines that look like section headers or descriptions
            if (item.length < 10 && /^[A-Z\s]+$/.test(item)) return false;
            // Filter out obviously wrong items
            if (/^(the|a|an|and|or|with)\s/i.test(item)) return false;
            return true;
        })
        .map(item => item.substring(0, 100)) // Limit length
        .slice(0, 20); // Limit to max 20 items per section
}

async function handlePDFUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const preview = document.getElementById('pdf-preview');
    preview.innerHTML = '<p>Loading and analyzing PDF...</p>';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;

        // Extract text from all pages with better formatting
        let fullText = '';
        let textLines = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            // Group text items by vertical position to maintain line structure
            const lines = [];
            let currentY = null;
            let currentLine = [];

            textContent.items.forEach(item => {
                const y = Math.round(item.transform[5]);

                if (currentY === null || Math.abs(y - currentY) < 5) {
                    currentLine.push(item.str);
                    currentY = y;
                } else {
                    if (currentLine.length > 0) {
                        lines.push(currentLine.join(' ').trim());
                    }
                    currentLine = [item.str];
                    currentY = y;
                }
            });

            if (currentLine.length > 0) {
                lines.push(currentLine.join(' ').trim());
            }

            textLines = textLines.concat(lines);
            fullText += lines.join('\n') + '\n';
        }

        currentMenu.pdfText = fullText;

        // Render first page as preview
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        preview.innerHTML = '<h3>PDF Preview (First Page)</h3>';
        preview.appendChild(canvas);

        const analysisDiv = document.createElement('div');
        analysisDiv.innerHTML = '<p style="margin-top: 15px; color: #27ae60; font-weight: 600;"><i class="fas fa-check-circle"></i> PDF analyzed successfully! Auto-detected menu structure below.</p>';
        preview.appendChild(analysisDiv);

        // Show configuration section
        document.getElementById('config-section').style.display = 'block';

        // Auto-suggest menu name from filename
        const menuName = file.name.replace('.pdf', '');
        currentMenu.name = menuName;

        // Parse the PDF text to extract menu structure
        currentMenu.sections = parseMenuFromText(textLines);

        if (currentMenu.sections.length === 0) {
            // If parsing failed, add one empty section for manual entry
            addSection();
        } else {
            renderSections();
        }

    } catch (error) {
        console.error('Error processing PDF:', error);
        preview.innerHTML = '<p class="validation-message error">Error loading PDF. Please try again.</p>';
    }
}

function addSection() {
    const sectionId = Date.now() + Math.random();
    const section = {
        id: sectionId,
        name: '',
        maxSelections: 1,
        items: ['']
    };

    currentMenu.sections.push(section);
    renderSections();
}

function renderSections() {
    const container = document.getElementById('sections-container');
    container.innerHTML = '';

    currentMenu.sections.forEach((section, sectionIndex) => {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'section-config';
        sectionDiv.innerHTML = `
            <div class="section-header">
                <div class="section-title">Section ${sectionIndex + 1}</div>
                <button class="delete-section-btn" onclick="deleteSection(${sectionIndex})">
                    <i class="fas fa-trash"></i> Delete Section
                </button>
            </div>

            <div class="form-group">
                <label>Section Name:</label>
                <input type="text" class="input" placeholder="e.g., Appetizers, Main Course, Desserts"
                       value="${section.name}"
                       onchange="updateSectionName(${sectionIndex}, this.value)">
            </div>

            <div class="form-group">
                <label>Maximum number of items guests can select:</label>
                <input type="number" class="input input-small" min="1" value="${section.maxSelections}"
                       onchange="updateSectionMaxSelections(${sectionIndex}, this.value)">
            </div>

            <div class="form-group">
                <label>Menu Items:</label>
                <div class="items-list" id="items-list-${sectionIndex}">
                    ${renderItems(section, sectionIndex)}
                </div>
                <button class="add-item-btn" onclick="addItem(${sectionIndex})">
                    <i class="fas fa-plus"></i> Add Item
                </button>
            </div>
        `;

        container.appendChild(sectionDiv);
    });
}

function renderItems(section, sectionIndex) {
    return section.items.map((item, itemIndex) => `
        <div class="item-entry">
            <input type="text" class="input" placeholder="Enter menu item name"
                   value="${item}"
                   onchange="updateItem(${sectionIndex}, ${itemIndex}, this.value)">
            ${section.items.length > 1 ? `
                <button class="remove-item-btn" onclick="removeItem(${sectionIndex}, ${itemIndex})">
                    <i class="fas fa-times"></i>
                </button>
            ` : ''}
        </div>
    `).join('');
}

function updateSectionName(sectionIndex, value) {
    currentMenu.sections[sectionIndex].name = value;
}

function updateSectionMaxSelections(sectionIndex, value) {
    currentMenu.sections[sectionIndex].maxSelections = parseInt(value) || 1;
}

function updateItem(sectionIndex, itemIndex, value) {
    currentMenu.sections[sectionIndex].items[itemIndex] = value;
}

function addItem(sectionIndex) {
    currentMenu.sections[sectionIndex].items.push('');
    renderSections();
}

function removeItem(sectionIndex, itemIndex) {
    currentMenu.sections[sectionIndex].items.splice(itemIndex, 1);
    renderSections();
}

function deleteSection(sectionIndex) {
    currentMenu.sections.splice(sectionIndex, 1);
    renderSections();
}

function saveMenu() {
    // Validate menu
    if (!currentMenu.name) {
        alert('Please upload a PDF to create a menu.');
        return;
    }

    if (currentMenu.sections.length === 0) {
        alert('Please add at least one section to your menu.');
        return;
    }

    // Validate sections
    for (let i = 0; i < currentMenu.sections.length; i++) {
        const section = currentMenu.sections[i];

        if (!section.name.trim()) {
            alert(`Please enter a name for Section ${i + 1}.`);
            return;
        }

        // Filter out empty items
        section.items = section.items.filter(item => item.trim() !== '');

        if (section.items.length === 0) {
            alert(`Section "${section.name}" must have at least one item.`);
            return;
        }
    }

    // Save to database
    const menuId = Date.now();
    const menuToSave = {
        id: menuId,
        name: currentMenu.name,
        dateCreated: new Date().toISOString(),
        sections: JSON.parse(JSON.stringify(currentMenu.sections))
    };

    menuDatabase.push(menuToSave);
    saveMenuDatabase();
    updateMenuList();

    // Show success message
    alert(`Menu "${currentMenu.name}" has been saved successfully!`);

    // Reset form
    resetChefInterface();
}

function saveMenuDatabase() {
    localStorage.setItem('menuDatabase', JSON.stringify(menuDatabase));
}

function loadMenuDatabase() {
    const saved = localStorage.getItem('menuDatabase');
    if (saved) {
        menuDatabase = JSON.parse(saved);
        updateMenuList();
    }
}

function resetChefInterface() {
    currentMenu = {
        name: '',
        pdfText: '',
        sections: []
    };

    document.getElementById('pdf-upload').value = '';
    document.getElementById('pdf-preview').innerHTML = '';
    document.getElementById('config-section').style.display = 'none';
    document.getElementById('sections-container').innerHTML = '';
}

function updateMenuList() {
    const select = document.getElementById('menu-list');
    select.innerHTML = '<option value="">-- Choose a menu --</option>';

    menuDatabase.forEach(menu => {
        const option = document.createElement('option');
        option.value = menu.id;
        option.textContent = `${menu.name} (${new Date(menu.dateCreated).toLocaleDateString()})`;
        select.appendChild(option);
    });
}

// ==================== GUEST INTERFACE ====================

function loadSelectedMenu() {
    const menuId = parseInt(document.getElementById('menu-list').value);
    if (!menuId) {
        document.getElementById('menu-display').style.display = 'none';
        return;
    }

    const menu = menuDatabase.find(m => m.id === menuId);
    if (!menu) {
        alert('Menu not found.');
        return;
    }

    currentOrder = {
        menuId: menuId,
        selections: {},
        dietaryPreferences: [],
        allergens: '',
        additionalNotes: ''
    };

    renderGuestMenu(menu);
    document.getElementById('menu-display').style.display = 'block';
}

function renderGuestMenu(menu) {
    const container = document.getElementById('menu-sections');
    container.innerHTML = '';

    menu.sections.forEach((section, sectionIndex) => {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'section menu-section';
        sectionDiv.dataset.sectionIndex = sectionIndex;

        const itemsHtml = section.items.map((item, itemIndex) => {
            const itemId = `item-${sectionIndex}-${itemIndex}`;
            return `
                <div class="menu-item" data-section="${sectionIndex}" data-item="${itemIndex}">
                    <div class="item-checkbox-container">
                        <input type="checkbox" id="${itemId}"
                               onchange="handleItemSelection(${sectionIndex}, ${itemIndex}, this.checked)">
                        <div class="item-details">
                            <label for="${itemId}" class="item-name">${item}</label>
                            <div class="specialization-input" id="spec-${itemId}">
                                <label>Special requests for this item:</label>
                                <input type="text" placeholder="e.g., no onions, extra sauce, well-done"
                                       oninput="updateSpecialization(${sectionIndex}, ${itemIndex}, this.value)">
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        sectionDiv.innerHTML = `
            <div class="menu-section-header">
                <h3 class="menu-section-title">${section.name}</h3>
                <div class="selection-limit">Select up to ${section.maxSelections}</div>
            </div>
            <div class="menu-items">
                ${itemsHtml}
            </div>
            <div id="validation-${sectionIndex}"></div>
        `;

        container.appendChild(sectionDiv);
    });

    // Reset dietary preferences
    document.querySelectorAll('#guest-interface .dietary-section input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });
    document.getElementById('allergens').value = '';
    document.getElementById('additional-notes').value = '';

    updateOrderSummary();
}

function handleItemSelection(sectionIndex, itemIndex, checked) {
    const menuId = currentOrder.menuId;
    const menu = menuDatabase.find(m => m.id === menuId);
    const section = menu.sections[sectionIndex];
    const maxSelections = section.maxSelections;

    // Initialize section selections if not exists
    if (!currentOrder.selections[sectionIndex]) {
        currentOrder.selections[sectionIndex] = {};
    }

    const sectionSelections = currentOrder.selections[sectionIndex];
    const currentCount = Object.keys(sectionSelections).length;

    if (checked) {
        // Check if we've reached the limit
        if (currentCount >= maxSelections) {
            // Uncheck the box
            const checkbox = document.getElementById(`item-${sectionIndex}-${itemIndex}`);
            checkbox.checked = false;

            showValidationMessage(sectionIndex, `You can only select up to ${maxSelections} item(s) from this section.`, 'error');
            return;
        }

        sectionSelections[itemIndex] = {
            name: section.items[itemIndex],
            specialization: ''
        };

        // Show specialization input
        const specDiv = document.getElementById(`spec-item-${sectionIndex}-${itemIndex}`);
        if (specDiv) {
            specDiv.classList.add('visible');
        }

        // Update item styling
        const itemDiv = document.querySelector(`.menu-item[data-section="${sectionIndex}"][data-item="${itemIndex}"]`);
        itemDiv.classList.add('selected');

        clearValidationMessage(sectionIndex);

    } else {
        delete sectionSelections[itemIndex];

        // Hide specialization input
        const specDiv = document.getElementById(`spec-item-${sectionIndex}-${itemIndex}`);
        if (specDiv) {
            specDiv.classList.remove('visible');
        }

        // Update item styling
        const itemDiv = document.querySelector(`.menu-item[data-section="${sectionIndex}"][data-item="${itemIndex}"]`);
        itemDiv.classList.remove('selected');
    }

    // Update disabled state of other checkboxes
    updateCheckboxStates(sectionIndex, maxSelections);
    updateOrderSummary();
}

function updateCheckboxStates(sectionIndex, maxSelections) {
    const sectionSelections = currentOrder.selections[sectionIndex] || {};
    const currentCount = Object.keys(sectionSelections).length;

    const menuItems = document.querySelectorAll(`.menu-item[data-section="${sectionIndex}"]`);
    menuItems.forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        const isChecked = checkbox.checked;

        if (!isChecked && currentCount >= maxSelections) {
            item.classList.add('disabled');
            checkbox.disabled = true;
        } else {
            item.classList.remove('disabled');
            checkbox.disabled = false;
        }
    });
}

function updateSpecialization(sectionIndex, itemIndex, value) {
    if (currentOrder.selections[sectionIndex] && currentOrder.selections[sectionIndex][itemIndex]) {
        currentOrder.selections[sectionIndex][itemIndex].specialization = value;
        updateOrderSummary();
    }
}

function showValidationMessage(sectionIndex, message, type) {
    const validationDiv = document.getElementById(`validation-${sectionIndex}`);
    validationDiv.innerHTML = `<div class="validation-message ${type}">${message}</div>`;

    setTimeout(() => {
        clearValidationMessage(sectionIndex);
    }, 3000);
}

function clearValidationMessage(sectionIndex) {
    const validationDiv = document.getElementById(`validation-${sectionIndex}`);
    if (validationDiv) {
        validationDiv.innerHTML = '';
    }
}

function updateOrderSummary() {
    const menuId = currentOrder.menuId;
    if (!menuId) return;

    const menu = menuDatabase.find(m => m.id === menuId);
    const summaryContainer = document.getElementById('order-summary-content');

    // Collect dietary preferences
    currentOrder.dietaryPreferences = [];
    document.querySelectorAll('#guest-interface .dietary-section input[type="checkbox"]:checked').forEach(cb => {
        currentOrder.dietaryPreferences.push(cb.nextElementSibling.textContent.trim());
    });

    currentOrder.allergens = document.getElementById('allergens').value;
    currentOrder.additionalNotes = document.getElementById('additional-notes').value;

    // Check if there are any selections
    const hasSelections = Object.keys(currentOrder.selections).some(sectionIndex => {
        return Object.keys(currentOrder.selections[sectionIndex]).length > 0;
    });

    if (!hasSelections && currentOrder.dietaryPreferences.length === 0 &&
        !currentOrder.allergens && !currentOrder.additionalNotes) {
        summaryContainer.innerHTML = '<p class="empty-state">Make your selections to see your order summary</p>';
        return;
    }

    let summaryHtml = '';

    // Add selections
    menu.sections.forEach((section, sectionIndex) => {
        const selections = currentOrder.selections[sectionIndex];
        if (selections && Object.keys(selections).length > 0) {
            summaryHtml += `
                <div class="summary-section">
                    <h3>${section.name}</h3>
                    ${Object.values(selections).map(item => `
                        <div class="summary-item">
                            <div class="summary-item-name">${item.name}</div>
                            ${item.specialization ? `<div class="summary-item-spec">Special request: ${item.specialization}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }
    });

    // Add dietary preferences
    if (currentOrder.dietaryPreferences.length > 0 || currentOrder.allergens || currentOrder.additionalNotes) {
        summaryHtml += '<div class="summary-preferences">';
        summaryHtml += '<h4>Dietary Information</h4>';

        if (currentOrder.dietaryPreferences.length > 0) {
            summaryHtml += `<p><strong>Preferences:</strong> ${currentOrder.dietaryPreferences.join(', ')}</p>`;
        }

        if (currentOrder.allergens) {
            summaryHtml += `<p><strong>Allergens:</strong> ${currentOrder.allergens}</p>`;
        }

        if (currentOrder.additionalNotes) {
            summaryHtml += `<p><strong>Additional Notes:</strong> ${currentOrder.additionalNotes}</p>`;
        }

        summaryHtml += '</div>';
    }

    summaryContainer.innerHTML = summaryHtml || '<p class="empty-state">Make your selections to see your order summary</p>';
}

function submitOrder() {
    const menuId = currentOrder.menuId;
    if (!menuId) {
        alert('Please select a menu first.');
        return;
    }

    const menu = menuDatabase.find(m => m.id === menuId);

    // Validate that at least one item is selected
    const hasSelections = Object.keys(currentOrder.selections).some(sectionIndex => {
        return Object.keys(currentOrder.selections[sectionIndex]).length > 0;
    });

    if (!hasSelections) {
        alert('Please select at least one item from the menu.');
        return;
    }

    // Prepare order summary
    let orderText = `ORDER SUMMARY\n`;
    orderText += `Menu: ${menu.name}\n`;
    orderText += `Date: ${new Date().toLocaleString()}\n\n`;

    menu.sections.forEach((section, sectionIndex) => {
        const selections = currentOrder.selections[sectionIndex];
        if (selections && Object.keys(selections).length > 0) {
            orderText += `${section.name.toUpperCase()}\n`;
            Object.values(selections).forEach(item => {
                orderText += `  - ${item.name}`;
                if (item.specialization) {
                    orderText += ` (${item.specialization})`;
                }
                orderText += '\n';
            });
            orderText += '\n';
        }
    });

    if (currentOrder.dietaryPreferences.length > 0 || currentOrder.allergens || currentOrder.additionalNotes) {
        orderText += 'DIETARY INFORMATION\n';
        if (currentOrder.dietaryPreferences.length > 0) {
            orderText += `Preferences: ${currentOrder.dietaryPreferences.join(', ')}\n`;
        }
        if (currentOrder.allergens) {
            orderText += `Allergens: ${currentOrder.allergens}\n`;
        }
        if (currentOrder.additionalNotes) {
            orderText += `Additional Notes: ${currentOrder.additionalNotes}\n`;
        }
    }

    // Show order in console and alert
    console.log(orderText);
    alert('Order submitted successfully!\n\nYour order has been logged to the console. In a production environment, this would be sent to the chef/kitchen.');

    // Optionally: Save order to localStorage
    const orders = JSON.parse(localStorage.getItem('orders') || '[]');
    orders.push({
        id: Date.now(),
        menuId: menuId,
        menuName: menu.name,
        order: currentOrder,
        timestamp: new Date().toISOString(),
        orderText: orderText
    });
    localStorage.setItem('orders', JSON.stringify(orders));

    // Reset order
    loadSelectedMenu();
}
