const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser, authenticateAdmin } = require('../middleware/auth');

const router = express.Router();

// Products endpoints

// Get products with filters and pagination
router.get('/products', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      status,
      featured,
      minPrice,
      maxPrice,
      search
    } = req.query;

    let query = supabase
      .from('products')
      .select('*', { count: 'exact' });

    // Apply filters
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (featured !== undefined) {
      query = query.eq('featured', featured === 'true');
    }

    if (minPrice) {
      query = query.gte('price', parseFloat(minPrice));
    }

    if (maxPrice) {
      query = query.lte('price', parseFloat(maxPrice));
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Apply pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);

    // Order by creation date (newest first)
    query = query.order('created_at', { ascending: false });

    const { data: products, error, count } = await query;

    if (error) {
      console.error('Error fetching products:', error);
      return res.status(500).json({ error: 'Failed to fetch products' });
    }

    const totalPages = Math.ceil(count / parseInt(limit));

    res.json({
      products: products || [],
      total: count || 0,
      page: parseInt(page),
      totalPages
    });
  } catch (error) {
    console.error('Error in get products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single product
router.get('/products/:id', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching product:', error);
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    console.error('Error in get product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create product
router.post('/products', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { name, description, price, category, stock, stock_quantity, image, status, active, featured } = req.body;

    const rawName = typeof name === 'string' ? name.trim() : '';
    const rawCategory = typeof category === 'string' ? category.trim() : '';

    const normalizedPrice = typeof price === 'number'
      ? price
      : Number((price ?? '').toString().replace(/[^\d.,-]/g, '').replace(',', '.'));
    const parsedPrice = Number.isNaN(normalizedPrice) ? NaN : normalizedPrice;

    if (!rawName || Number.isNaN(parsedPrice) || !rawCategory) {
      return res.status(400).json({ error: 'Name, price, and category are required' });
    }

    const parsedStockInput = stock !== undefined ? stock : stock_quantity;
    const parsedStock = parsedStockInput !== undefined ? parseInt(parsedStockInput) : 0;

    const isActive = typeof active === 'boolean' ? active : (status ? status === 'active' : true);
    const computedStatus = status || ((parsedStock || 0) > 0 ? 'active' : 'out_of_stock');

    const productData = {
      name: rawName,
      description,
      price: parsedPrice,
      category: rawCategory,
      stock: Number.isNaN(parsedStock) ? 0 : parsedStock,
      status: computedStatus,
      active: isActive,
      featured: !!featured,
      image,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: product, error } = await supabase
      .from('products')
      .insert([productData])
      .select()
      .single();

    if (error) {
      console.error('Error creating product:', error);
      return res.status(400).json({ error: error.message, details: error.details || null, code: error.code || null, hint: error.hint || null });
    }

    res.status(201).json(product);
  } catch (error) {
    console.error('Error in create product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update product
router.put('/products/:id', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, category, stock, stock_quantity, image, active, status, featured } = req.body;

    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = typeof name === 'string' ? name.trim() : name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) {
      const normalized = typeof price === 'number' ? price : Number((price ?? '').toString().replace(/[^\d.,-]/g, '').replace(',', '.'));
      if (!Number.isNaN(normalized)) updateData.price = normalized;
    }
    if (category !== undefined) updateData.category = category;

    if (stock !== undefined || stock_quantity !== undefined) {
      const s = stock !== undefined ? stock : stock_quantity;
      const parsed = parseInt(s);
      if (!Number.isNaN(parsed)) updateData.stock = parsed;
      updateData.status = parsed > 0 ? 'active' : 'out_of_stock';
    }

    if (image !== undefined) updateData.image = image;
    if (featured !== undefined) updateData.featured = !!featured;

    if (active !== undefined) {
      updateData.active = active;
    } else if (status !== undefined) {
      updateData.active = status === 'active';
      updateData.status = status;
    }

    const { data: product, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating product:', error);
      return res.status(400).json({ error: error.message, details: error.details || null, code: error.code || null, hint: error.hint || null });
    }

    res.json(product);
  } catch (error) {
    console.error('Error in update product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete product
router.delete('/products/:id', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting product:', error);
      return res.status(400).json({ error: 'Failed to delete product' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error in delete product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update product stock
router.patch('/products/:id/stock', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;

    const parsed = parseInt(stock);
    const status = !Number.isNaN(parsed) && parsed > 0 ? 'active' : 'out_of_stock';

    const { data: product, error } = await supabase
      .from('products')
      .update({ 
        stock: Number.isNaN(parsed) ? 0 : parsed,
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating stock:', error);
      return res.status(400).json({ error: error.message, details: error.details || null, code: error.code || null, hint: error.hint || null });
    }

    res.json(product);
  } catch (error) {
    console.error('Error in update stock:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle product featured status
router.patch('/products/:id/featured', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Get current featured status
    const { data: currentProduct } = await supabase
      .from('products')
      .select('featured')
      .eq('id', id)
      .single();

    const { data: product, error } = await supabase
      .from('products')
      .update({ 
        featured: !currentProduct.featured,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error toggling featured:', error);
      return res.status(400).json({ error: 'Failed to toggle featured status' });
    }

    res.json(product);
  } catch (error) {
    console.error('Error in toggle featured:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Orders endpoints

// Get orders with filters and pagination
router.get('/orders', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      paymentStatus,
      dateFrom,
      dateTo,
      search
    } = req.query;

    let query = supabase
      .from('orders')
      .select('*', { count: 'exact' });

    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }

    if (paymentStatus) {
      query = query.eq('payment_status', paymentStatus);
    }

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    if (search) {
      query = query.or(`id.ilike.%${search}%,customer_name.ilike.%${search}%,customer_email.ilike.%${search}%`);
    }

    // Apply pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);

    // Order by creation date (newest first)
    query = query.order('created_at', { ascending: false });

    const { data: orders, error, count } = await query;

    if (error) {
      console.error('Error fetching orders:', error);
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    const totalPages = Math.ceil(count / parseInt(limit));

    res.json({
      orders: orders || [],
      total: count || 0,
      page: parseInt(page),
      totalPages
    });
  } catch (error) {
    console.error('Error in get orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single order
router.get('/orders/:id', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching order:', error);
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error in get order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update order status
router.patch('/orders/:id/status', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data: order, error } = await supabase
      .from('orders')
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating order status:', error);
      return res.status(400).json({ error: 'Failed to update order status' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error in update order status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update payment status
router.patch('/orders/:id/payment-status', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus } = req.body;

    const { data: order, error } = await supabase
      .from('orders')
      .update({ 
        payment_status: paymentStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating payment status:', error);
      return res.status(400).json({ error: 'Failed to update payment status' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error in update payment status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add tracking code
router.patch('/orders/:id/tracking', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingCode } = req.body;

    const { data: order, error } = await supabase
      .from('orders')
      .update({ 
        tracking_code: trackingCode,
        status: 'shipped',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error adding tracking code:', error);
      return res.status(400).json({ error: 'Failed to add tracking code' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error in add tracking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel order
router.patch('/orders/:id/cancel', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: order, error } = await supabase
      .from('orders')
      .update({ 
        status: 'cancelled',
        cancellation_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error cancelling order:', error);
      return res.status(400).json({ error: 'Failed to cancel order' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error in cancel order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get store statistics
router.get('/stats', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // Get product stats
    const { data: productStats } = await supabase
      .from('products')
      .select('status')
      .then(result => {
        const stats = result.data?.reduce((acc, product) => {
          acc.total++;
          if (product.status === 'active') acc.active++;
          if (product.status === 'out_of_stock') acc.outOfStock++;
          return acc;
        }, { total: 0, active: 0, outOfStock: 0 }) || { total: 0, active: 0, outOfStock: 0 };
        return { data: stats };
      });

    // Get order stats
    const { data: orderStats } = await supabase
      .from('orders')
      .select('status, total, created_at')
      .then(result => {
        const now = new Date();
        const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const stats = result.data?.reduce((acc, order) => {
          acc.total++;
          if (order.status === 'pending') acc.pending++;
          
          const orderDate = new Date(order.created_at);
          if (orderDate >= currentMonth) {
            acc.monthlyRevenue += order.total || 0;
          }
          acc.totalRevenue += order.total || 0;
          
          return acc;
        }, { total: 0, pending: 0, totalRevenue: 0, monthlyRevenue: 0 }) || 
        { total: 0, pending: 0, totalRevenue: 0, monthlyRevenue: 0 };
        
        stats.averageOrderValue = stats.total > 0 ? stats.totalRevenue / stats.total : 0;
        return { data: stats };
      });

    // Get top selling products
    const { data: topProducts } = await supabase
      .from('products')
      .select('id, name, sold, price')
      .order('sold', { ascending: false })
      .limit(5)
      .then(result => ({
        data: result.data?.map(product => ({
          id: product.id,
          name: product.name,
          sold: product.sold || 0,
          revenue: (product.sold || 0) * (product.price || 0)
        })) || []
      }));

    const stats = {
      totalProducts: productStats.total,
      activeProducts: productStats.active,
      outOfStock: productStats.outOfStock,
      totalOrders: orderStats.total,
      pendingOrders: orderStats.pending,
      totalRevenue: orderStats.totalRevenue,
      monthlyRevenue: orderStats.monthlyRevenue,
      averageOrderValue: orderStats.averageOrderValue,
      topSellingProducts: topProducts.data
    };

    res.json(stats);
  } catch (error) {
    console.error('Error in get store stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get categories
router.get('/categories', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('category');

    if (error) {
      console.error('Error fetching categories:', error);
      return res.status(400).json({ error: error.message, details: error.details || null, code: error.code || null, hint: error.hint || null });
    }

    const uniqueCategories = [...new Set((data || []).map(p => p.category).filter(Boolean))];
    res.json(uniqueCategories);
  } catch (error) {
    console.error('Error in get categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export endpoints (placeholder - would need actual implementation)
router.get('/export/products', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // This would implement actual CSV/Excel export
    res.status(501).json({ error: 'Export functionality not yet implemented' });
  } catch (error) {
    console.error('Error in export products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/export/orders', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // This would implement actual CSV/Excel export
    res.status(501).json({ error: 'Export functionality not yet implemented' });
  } catch (error) {
    console.error('Error in export orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;