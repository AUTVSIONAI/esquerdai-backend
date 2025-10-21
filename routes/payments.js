const express = require('express');
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  } else {
    console.warn('⚠️ STRIPE_SECRET_KEY ausente; rotas de pagamentos ficarão desativadas.');
  }
} catch (e) {
  console.warn('⚠️ Stripe não inicializado:', e.message);
  stripe = null;
}
const { supabase } = require('../config/supabase');
const router = express.Router();

// Flag para usar dados mock temporariamente
const USE_MOCK_DATA = false;

// Importar middleware de autenticação
const { authenticateUser } = require('../middleware/auth');

// Planos disponíveis
const PLANS = {
  engajado: {
    name: 'Patriota Engajado',
    price: 2990, // R$ 29,90 em centavos
    currency: 'brl',
    interval: 'month',
    features: [
      '5 análises de fake news por dia',
      '20 mensagens com IA Criativa por dia',
      '3 conversas com agentes políticos por dia',
      'Acesso completo à Constituição',
      'Histórico completo de análises',
      'Compartilhamento de resultados',
      'Sem anúncios',
      'Badge especial no perfil',
      'Notificações prioritárias'
    ]
  },
  lider: {
    name: 'Patriota Líder',
    price: 5990, // R$ 59,90 em centavos
    currency: 'brl',
    interval: 'month',
    features: [
      '10 análises de fake news por dia',
      '50 mensagens com IA Criativa por dia',
      'Conversas ilimitadas com agentes políticos',
      'Acesso completo à Constituição',
      'Análises com IA premium (modelos mais avançados)',
      'Relatórios semanais personalizados',
      'Acesso antecipado a novos recursos',
      'Suporte prioritário',
      'API para desenvolvedores (100 calls/dia)'
    ]
  },
  supremo: {
    name: 'Patriota Supremo',
    price: 8990, // R$ 89,90 em centavos
    currency: 'brl',
    interval: 'month',
    features: [
      '20 análises de fake news por dia',
      'IA Criativa ilimitada',
      'Todos os agentes políticos ilimitados',
      'Acesso completo à Constituição',
      'IA premium com modelos exclusivos',
      'Consultoria política personalizada (1h/mês)',
      'Criação de eventos próprios',
      'Rede de contatos VIP',
      'API premium (1000 calls/dia)',
      'White-label para organizações'
    ]
  }
};

// Endpoint para criar sessão de checkout
router.post('/checkout', authenticateUser, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Pagamentos indisponíveis no ambiente de desenvolvimento' });
  try {
    const { planId } = req.body;
    const userId = req.user.id;

    console.log('Checkout request:', { planId, userId });

    if (!planId || !PLANS[planId]) {
      return res.status(400).json({ error: 'Plano inválido' });
    }

    const plan = PLANS[planId];

    // Criar sessão de checkout do Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: plan.currency,
          product_data: {
            name: plan.name,
            description: `Assinatura mensal do plano ${plan.name}`
          },
          unit_amount: plan.price,
          recurring: {
            interval: plan.interval
          }
        },
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/dashboard/plan?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard/plan?canceled=true`,
      client_reference_id: userId,
      metadata: {
        userId: userId,
        planId: planId
      }
    });

    console.log('Stripe session created:', session.id);

    res.json({ 
      sessionId: session.id,
      url: session.url 
    });
  } catch (error) {
    console.error('Erro ao criar sessão de checkout:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error.message 
    });
  }
});

// Webhook do Stripe
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).send('Stripe não configurado');
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Webhook event received:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Função para lidar com checkout completado
async function handleCheckoutCompleted(session) {
  console.log('Processing checkout completed:', session.id);
  
  const userId = session.client_reference_id || session.metadata?.userId;
  const planId = session.metadata?.planId;
  
  if (!userId) {
    console.error('No user ID found in session');
    return;
  }

  try {
    // Atualizar informações do usuário no Supabase
    const { error } = await supabase
      .from('users')
      .update({
        subscription_status: 'active',
        subscription_plan: planId,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        updated_at: new Date().toISOString()
      })
      .eq('auth_id', userId);

    if (error) {
      console.error('Error updating user subscription:', error);
    } else {
      console.log('User subscription updated successfully');
    }
  } catch (error) {
    console.error('Error in handleCheckoutCompleted:', error);
  }
}

// Função para lidar com atualização de assinatura
async function handleSubscriptionUpdated(subscription) {
  console.log('Processing subscription updated:', subscription.id);
  
  try {
    const { error } = await supabase
      .from('users')
      .update({
        subscription_status: subscription.status,
        updated_at: new Date().toISOString()
      })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Error updating subscription:', error);
    }
  } catch (error) {
    console.error('Error in handleSubscriptionUpdated:', error);
  }
}

// Função para lidar com cancelamento de assinatura
async function handleSubscriptionDeleted(subscription) {
  console.log('Processing subscription deleted:', subscription.id);
  
  try {
    const { error } = await supabase
      .from('users')
      .update({
        subscription_status: 'canceled',
        subscription_plan: null,
        stripe_subscription_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Error canceling subscription:', error);
    }
  } catch (error) {
    console.error('Error in handleSubscriptionDeleted:', error);
  }
}

// Função para lidar com falha de pagamento
async function handlePaymentFailed(invoice) {
  console.log('Processing payment failed:', invoice.id);
  
  try {
    const { error } = await supabase
      .from('users')
      .update({
        subscription_status: 'past_due',
        updated_at: new Date().toISOString()
      })
      .eq('stripe_subscription_id', invoice.subscription);

    if (error) {
      console.error('Error updating payment failed status:', error);
    }
  } catch (error) {
    console.error('Error in handlePaymentFailed:', error);
  }
}

// Endpoint para obter planos disponíveis
router.get('/plans', async (req, res) => {
  try {
    if (USE_MOCK_DATA) {
      // Dados mock para desenvolvimento
      const mockPlans = {
        engajado: {
          ...PLANS.engajado,
          id: 'mock_engajado',
          active: true
        },
        lider: {
          ...PLANS.lider,
          id: 'mock_lider',
          active: true
        },
        supremo: {
          ...PLANS.supremo,
          id: 'mock_supremo',
          active: true
        }
      };
      
      return res.json({
        success: true,
        plans: mockPlans,
        mock: true
      });
    }

    // Buscar produtos do Stripe (implementação real)
    const products = await stripe.products.list({
      active: true,
      expand: ['data.default_price']
    });

    const formattedPlans = {};
    
    // Mapear produtos do Stripe para nossos planos
    Object.keys(PLANS).forEach(planKey => {
      const plan = PLANS[planKey];
      const stripeProduct = products.data.find(p => 
        p.name.toLowerCase().includes(planKey) || 
        p.metadata?.planId === planKey
      );

      formattedPlans[planKey] = {
        ...plan,
        id: planKey,
        stripeProductId: stripeProduct?.id,
        stripePriceId: stripeProduct?.default_price?.id,
        active: !!stripeProduct
      };
    });

    res.json({
      success: true,
      plans: formattedPlans
    });
  } catch (error) {
    console.error('Erro ao buscar planos:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar planos',
      details: error.message 
    });
  }
});

// Endpoint para obter informações da assinatura do usuário
router.get('/subscription', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    // Buscar informações do usuário no Supabase
    const { data: user, error } = await supabase
      .from('users')
      .select('subscription_status, subscription_plan, stripe_customer_id, stripe_subscription_id')
      .eq('auth_id', userId)
      .single();

    if (error) {
      console.error('Error fetching user subscription:', error);
      return res.status(500).json({ error: 'Erro ao buscar assinatura' });
    }

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    let subscriptionDetails = null;
    
    // Se o usuário tem uma assinatura ativa, buscar detalhes no Stripe
    if (user.stripe_subscription_id && user.subscription_status === 'active') {
      try {
        const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
        subscriptionDetails = {
          id: subscription.id,
          status: subscription.status,
          current_period_start: subscription.current_period_start,
          current_period_end: subscription.current_period_end,
          cancel_at_period_end: subscription.cancel_at_period_end
        };
      } catch (stripeError) {
        console.error('Error fetching Stripe subscription:', stripeError);
        // Continue sem os detalhes do Stripe se houver erro
      }
    }

    res.json({
      success: true,
      subscription: {
        status: user.subscription_status || 'inactive',
        plan: user.subscription_plan,
        planDetails: user.subscription_plan ? PLANS[user.subscription_plan] : null,
        stripeDetails: subscriptionDetails
      }
    });
  } catch (error) {
    console.error('Erro ao buscar assinatura:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error.message 
    });
  }
});

module.exports = router;