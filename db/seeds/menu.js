const fs = require('fs');
const path = require('path');

exports.seed = async function(knex) {
    // clear menu tables (delete items first because of FK)
    await knex('menu_items').del();
    await knex('menu_categories').del();

    const now = new Date();

    const categories = [
        { id: 1, name: 'HuvudRätter', description: 'Huvudrätter', position:1  },
        { id: 2, name: 'Tillbehör', description: 'Tillbehör', position:2  },
        { id: 3, name: 'Drycker', description: 'Drycker', position:3  },
        { id: 4, name: 'Desserter', description: 'Desserter', position:4  }
    ];

    await knex('menu_categories').insert(categories);

    // base folder where seed images live
    const imagesDir = path.resolve(__dirname, './images');

    function readImageBuffer(filename) {
        const p = path.join(imagesDir, filename);
        // synchronous read is fine in seed scripts
        if (!fs.existsSync(p)) return null;
        return fs.readFileSync(p);
    }

    const items = [
        { category_id: 1, name: 'Spicy Korean Bowl', description: 'Gochujang glazed chicken, jasmine rice, kimchi, pickled veg, sesame', price: 135, available: true, position: 1, image: readImageBuffer('Bowl.png'), created_at: now, updated_at: now },
        { category_id: 1, name: 'Teriyaki Salmon', description: 'Grilled salmon, teriyaki glaze, edamame, brown rice, miso dressing', price: 155, available: true, position: 1, image: readImageBuffer('Salmon.png'), created_at: now, updated_at: now },
        { category_id: 1, name: 'Vietnamese Banh Mi', description: 'Crispy pork belly, pickled carrots, cilantro, jalapeños, sriracha mayo', price: 115, available: true, position: 1, image: readImageBuffer('Banh.png'), created_at: now, updated_at: now },
        { category_id: 1, name: 'Green Curry', description: 'Coconut green curry, tofu, Thai basil, vegetables, jasmine rice', price: 125, available: true, position: 1, image: readImageBuffer('Curry.png'), created_at: now, updated_at: now },
        { category_id: 1, name: 'Poke Bowl', description: 'Ahi tuna, avocado, edamame, seaweed salad, ponzu, sesame seeds', price: 145, available: true, position: 1, image: readImageBuffer('PokeBowl.png'), created_at: now, updated_at: now },
        { category_id: 1, name: 'Crispy Duck Noodles', description: 'Crispy duck, stir-fried noodles, bok choy, hoisin sauce', price: 140, available: true, position: 1, image: readImageBuffer('Duck.png'), created_at: now, updated_at: now },

        { category_id: 2, name: 'Gyoza', description: 'Pan-fried dumplings with soy-ginger dipping sauce', price: 65, available: true, position: 2, image: readImageBuffer('Gyoza.png'), created_at: now, updated_at: now },
        { category_id: 2, name: 'Edamame', description: 'Steamed soybeans with sea salt', price: 45, available: true, position: 2, image: readImageBuffer('Edamame.png'), created_at: now, updated_at: now },
        { category_id: 2, name: 'Spring Rolls', description: 'Fresh spring rolls with peanut dipping sauce', price: 55, available: true, position: 2, image: readImageBuffer('SpringRolls.png'), created_at: now, updated_at: now },
        { category_id: 2, name: 'Kimchi Fries', description: 'Crispy fries topped with kimchi and spicy mayo', price: 70, available: true, position: 2, image: readImageBuffer('Kimchi.png'), created_at: now, updated_at: now },

        { category_id: 3, name: 'Yuzu Lemonade', description: 'Refreshing citrus drink with Japanese yuzu', price: 45, available: true, position: 3, image: readImageBuffer('Yuzu.png'), created_at: now, updated_at: now },
        { category_id: 3, name: 'Thai Iced Tea', description: 'Sweet and creamy traditional Thai tea', price: 45, available: true, position: 3, image: readImageBuffer('IceTea.png'), created_at: now, updated_at: now },
        { category_id: 3, name: 'Kombucha', description: 'House-made ginger and lime kombucha', price: 50, available: true, position: 3, image: readImageBuffer('Kombucha.png'), created_at: now, updated_at: now },
        { category_id: 3, name: 'Matcha Latte', description: 'Premium matcha with oat milk', price: 55, available: true, position: 3, image: readImageBuffer('MatchaLatte.png'), created_at: now, updated_at: now },

        { category_id: 4, name: 'Mochi Ice Cream', description: 'Four pieces - 2 mango and 2 matcha', price: 65, available: true, position: 4, image: readImageBuffer('Mochi.png'), created_at: now, updated_at: now },
        { category_id: 4, name: 'Matcha Tiramisu', description: 'Japanese twist on Italian classic', price: 75, available: true, position: 4, image: readImageBuffer('Tiramisu.png'), created_at: now, updated_at: now }
    ];

    // remove image fields that are null to avoid inserting explicit nulls if file missing
    const sanitized = items.map(i => {
        const copy = { ...i };
        if (copy.image === null) delete copy.image;
        return copy;
    });

    await knex('menu_items').insert(sanitized);
};
