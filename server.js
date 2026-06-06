require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'splitwise-super-secret-key-2026';

const prisma = new PrismaClient();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Colors for default avatars
const AVATAR_COLORS = [
  '#5B5BD6', // Indigo
  '#0EA5E9', // Sky Blue
  '#DC2626', // Red
  '#D97706', // Orange
  '#8B5CF6', // Purple
  '#16A34A', // Green
  '#EC4899', // Pink
  '#14B8A6'  // Teal
];

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Expecting "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded; // Contains { id, email }
    next();
  });
}

// ----------------------------------------------------
// AUTH ENDPOINTS
// ----------------------------------------------------

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash Password
    const passwordHash = await bcrypt.hash(password, 10);

    // Compute initials (e.g. "Arjun Sharma" -> "AS")
    const parts = name.trim().split(/\s+/);
    const ini = parts.map(p => p[0]).join('').substring(0, 2).toUpperCase() || '?';

    // Pick random avatar color
    const col = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    // Create user in DB
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        ini,
        col
      }
    });

    // Create a default welcome notification
    await prisma.notification.create({
      data: {
        userId: user.id,
        title: 'Welcome to Splitwise Mini Pro!',
        body: 'Create a group and invite friends to start splitting expenses.',
        time: 'Just now',
        type: 'invite'
      }
    });

    // Sign JWT Token
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        ini: user.ini,
        col: user.col
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        ini: user.ini,
        col: user.col
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ME (Profile)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, ini: true, col: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Retrieve user counts
    const expensesCount = await prisma.expenseSplit.count({ where: { userId: user.id } });
    const groupsCount = await prisma.groupMember.count({ where: { userId: user.id } });
    const settlementsCount = await prisma.settlement.count({
      where: {
        OR: [{ fromUserId: user.id }, { toUserId: user.id }]
      }
    });

    res.json({
      ...user,
      stats: {
        expenses: expensesCount,
        groups: groupsCount,
        settlements: settlementsCount
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// USERS API
// ----------------------------------------------------
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, ini: true, col: true }
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// GROUPS API
// ----------------------------------------------------
app.get('/api/groups', authenticateToken, async (req, res) => {
  try {
    // Get all groups where user is a member
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user.id },
      include: {
        group: {
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, name: true, email: true, ini: true, col: true }
                }
              }
            },
            expenses: {
              include: {
                splits: true
              }
            }
          }
        }
      }
    });

    const enrichedGroups = [];
    for (const membership of memberships) {
      const g = membership.group;
      const spent = g.expenses.reduce((sum, e) => sum + e.amount, 0);
      
      enrichedGroups.push({
        id: g.id,
        name: g.name,
        emoji: g.emoji,
        cat: g.cat,
        budget: g.budget,
        created: g.created,
        members: g.members.map(m => m.user.id),
        memberDetails: g.members.map(m => m.user),
        spent
      });
    }

    res.json(enrichedGroups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups', authenticateToken, async (req, res) => {
  try {
    const { name, emoji, cat, budget, members } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const created = new Date().toISOString().split('T')[0];

    // Ensure current user is in the members list
    const memberIds = Array.from(new Set([req.user.id, ...(members || [])]));

    const group = await prisma.$transaction(async (tx) => {
      const g = await tx.group.create({
        data: {
          name,
          emoji,
          cat,
          budget: budget ? parseInt(budget) : null,
          created
        }
      });

      // Add group members
      await tx.groupMember.createMany({
        data: memberIds.map(uid => ({
          groupId: g.id,
          userId: uid
        }))
      });

      // Create budget if set
      if (budget) {
        await tx.budget.create({
          data: {
            groupId: g.id,
            limitAmount: parseInt(budget)
          }
        });
      }

      return g;
    });

    res.json({ success: true, gid: group.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// EXPENSES API
// ----------------------------------------------------
app.get('/api/expenses', authenticateToken, async (req, res) => {
  try {
    const { gid } = req.query;

    let whereClause = {};
    if (gid) {
      whereClause.gid = gid;
    } else {
      // Find expenses belonging to groups current user is in
      const memberships = await prisma.groupMember.findMany({
        where: { userId: req.user.id },
        select: { groupId: true }
      });
      const userGroupIds = memberships.map(m => m.groupId);

      whereClause = {
        OR: [
          { gid: { in: userGroupIds } },
          { paidById: req.user.id },
          { splits: { some: { userId: req.user.id } } }
        ]
      };
    }

    const expenses = await prisma.expense.findMany({
      where: whereClause,
      include: {
        splits: true,
        paidBy: { select: { id: true, name: true, email: true, ini: true, col: true } }
      },
      orderBy: { date: 'desc' }
    });

    const enriched = expenses.map(e => {
      const splitUserIds = e.splits.map(s => s.userId);
      const pcts = {};
      const exacts = {};
      const shares = {};

      e.splits.forEach(s => {
        if (e.type === 'percentage') pcts[s.userId] = s.inputValue;
        if (e.type === 'exact') exacts[s.userId] = s.inputValue;
        if (e.type === 'shares') shares[s.userId] = s.inputValue;
      });

      return {
        id: e.id,
        gid: e.gid,
        title: e.title,
        amount: e.amount,
        paidBy: e.paidById,
        paidByDetail: e.paidBy,
        type: e.type,
        cat: e.cat,
        date: e.date,
        note: e.note,
        tags: e.tags ? e.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        split: splitUserIds,
        pcts,
        exacts,
        shares
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', authenticateToken, async (req, res) => {
  try {
    const { title, amount, paidBy, gid, type, cat, date, tags, note, split, pcts, exacts, shares } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!title || isNaN(parsedAmount) || !paidBy || !split || split.length === 0) {
      return res.status(400).json({ error: 'Missing required expense parameters' });
    }

    const splitUsers = split || [];
    const splitsData = [];

    // Calculate share amounts for each split user based on type
    if (type === 'percentage') {
      for (const uid of splitUsers) {
        const pct = parseFloat(pcts?.[uid] || 0);
        const sh = (parsedAmount * pct) / 100;
        splitsData.push({ userId: uid, shareAmount: sh, inputValue: pct });
      }
    } else if (type === 'exact') {
      for (const uid of splitUsers) {
        const exact = parseFloat(exacts?.[uid] || 0);
        splitsData.push({ userId: uid, shareAmount: exact, inputValue: exact });
      }
    } else if (type === 'shares') {
      const totalShares = splitUsers.reduce((s, uid) => s + parseFloat(shares?.[uid] || 1), 0) || 1;
      for (const uid of splitUsers) {
        const shCount = parseFloat(shares?.[uid] || 1);
        const sh = (parsedAmount * shCount) / totalShares;
        splitsData.push({ userId: uid, shareAmount: sh, inputValue: shCount });
      }
    } else {
      // equal
      const sh = parsedAmount / splitUsers.length;
      for (const uid of splitUsers) {
        splitsData.push({ userId: uid, shareAmount: sh, inputValue: 1 });
      }
    }

    const expense = await prisma.$transaction(async (tx) => {
      const exp = await tx.expense.create({
        data: {
          gid: gid || null,
          title,
          amount: parsedAmount,
          paidById: paidBy,
          type,
          cat,
          date,
          note: note || '',
          tags: tags || ''
        }
      });

      // Insert splits
      for (const s of splitsData) {
        await tx.expenseSplit.create({
          data: {
            expenseId: exp.id,
            userId: s.userId,
            shareAmount: s.shareAmount,
            inputValue: s.inputValue
          }
        });
      }

      return exp;
    });

    // Generate Notifications for split members (excluding the creator)
    const paidByUser = await prisma.user.findUnique({ where: { id: paidBy } });
    const payerName = paidByUser.name.split(' ')[0];
    const bodyText = `${payerName} added "${title}" ₹${parsedAmount.toLocaleString('en-IN')}`;

    for (const uid of splitUsers) {
      if (uid !== req.user.id) {
        await prisma.notification.create({
          data: {
            userId: uid,
            title: 'New expense added',
            body: bodyText,
            time: 'Just now',
            type: 'expense'
          }
        });
      }
    }

    // Check Budget limits if groupId exists
    if (gid) {
      const budget = await prisma.budget.findUnique({ where: { groupId: gid } });
      if (budget) {
        const expenses = await prisma.expense.findMany({ where: { gid } });
        const totalSpent = expenses.reduce((s, exp) => s + exp.amount, 0);
        const pct = Math.round((totalSpent / budget.limitAmount) * 100);

        if (pct >= 80) {
          const group = await prisma.group.findUnique({ where: { id: gid } });
          const groupMembers = await prisma.groupMember.findMany({ where: { groupId: gid } });
          
          for (const gm of groupMembers) {
            await prisma.notification.create({
              data: {
                userId: gm.userId,
                title: pct >= 100 ? 'Budget Limit Exceeded' : 'Budget Warning',
                body: `${group.name} is at ${pct}% of its budget limit (${totalSpent.toLocaleString('en-IN')}/${budget.limitAmount.toLocaleString('en-IN')})`,
                time: 'Just now',
                type: 'budget'
              }
            });
          }
        }
      }
    }

    res.json({ success: true, eid: expense.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', authenticateToken, async (req, res) => {
  try {
    const eid = req.params.id;
    await prisma.expense.delete({ where: { id: eid } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// SETTLEMENTS API
// ----------------------------------------------------

// Helpers for Cash Flow within User's network
async function calculateNetBalances(userId) {
  // Find all groups the user is in
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true }
  });
  const groupIds = memberships.map(m => m.groupId);

  // Retrieve all members of these groups to build the network
  const networkMemberships = await prisma.groupMember.findMany({
    where: { groupId: { in: groupIds } },
    select: { userId: true }
  });
  const networkUserIds = Array.from(new Set(networkMemberships.map(m => m.userId)));

  const net = {};
  networkUserIds.forEach(uid => { net[uid] = 0; });

  // Add credits for payments made in this network
  const expenses = await prisma.expense.findMany({
    where: {
      OR: [
        { gid: { in: groupIds } },
        { paidById: { in: networkUserIds } },
        { splits: { some: { userId: { in: networkUserIds } } } }
      ]
    },
    include: { splits: true }
  });

  expenses.forEach(e => {
    e.splits.forEach(s => {
      if (s.userId !== e.paidById) {
        if (net[s.userId] !== undefined) net[s.userId] -= s.shareAmount;
        if (net[e.paidById] !== undefined) net[e.paidById] += s.shareAmount;
      }
    });
  });

  // Apply settlements recorded in the database
  const settlements = await prisma.settlement.findMany({
    where: {
      OR: [
        { fromUserId: { in: networkUserIds } },
        { toUserId: { in: networkUserIds } }
      ]
    }
  });

  settlements.forEach(s => {
    if (net[s.fromUserId] !== undefined) net[s.fromUserId] += s.amount;
    if (net[s.toUserId] !== undefined) net[s.toUserId] -= s.amount;
  });

  return { net, networkUserIds };
}

function minCashFlow(net) {
  const cred = [], deb = [];
  Object.entries(net).forEach(([id, b]) => {
    if (b > 0.5) cred.push({ id, a: b });
    else if (b < -0.5) deb.push({ id, a: -b });
  });
  cred.sort((a, b) => b.a - a.a);
  deb.sort((a, b) => b.a - a.a);

  const txns = [];
  let i = 0, j = 0;
  while (i < cred.length && j < deb.length) {
    const amt = Math.min(cred[i].a, deb[j].a);
    if (amt > 0.5) {
      txns.push({ from: deb[j].id, to: cred[i].id, amount: Math.round(amt) });
    }
    cred[i].a -= amt;
    deb[j].a -= amt;
    if (cred[i].a < 0.5) i++;
    if (deb[j].a < 0.5) j++;
  }
  return txns;
}

app.get('/api/settlements', authenticateToken, async (req, res) => {
  try {
    const { net, networkUserIds } = await calculateNetBalances(req.user.id);
    const optimizedPlan = minCashFlow(net);

    // Retrieve settlements list
    const settlements = await prisma.settlement.findMany({
      where: {
        OR: [
          { fromUserId: { in: networkUserIds } },
          { toUserId: { in: networkUserIds } }
        ]
      },
      orderBy: { date: 'desc' }
    });

    const formattedHistory = settlements.map(s => ({
      id: s.id,
      from: s.fromUserId,
      to: s.toUserId,
      amount: s.amount,
      date: s.date,
      method: s.method,
      status: s.status
    }));

    res.json({
      history: formattedHistory,
      optimizedPlan,
      netBalances: net
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settlements', authenticateToken, async (req, res) => {
  try {
    const { from, to, amount, method } = req.body;
    const date = new Date().toISOString().split('T')[0];

    if (!from || !to || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: 'Missing settlement arguments' });
    }

    const parsedAmt = parseFloat(amount);

    await prisma.$transaction(async (tx) => {
      await tx.settlement.create({
        data: {
          fromUserId: from,
          toUserId: to,
          amount: parsedAmt,
          date,
          method: method || 'UPI',
          status: 'completed'
        }
      });

      // Send Notification to recipient
      const fromUser = await tx.user.findUnique({ where: { id: from } });
      const fromName = fromUser.name.split(' ')[0];

      await tx.notification.create({
        data: {
          userId: to,
          title: 'Settlement received',
          body: `${fromName} paid you ₹${parsedAmt.toLocaleString('en-IN')} via ${method || 'UPI'}`,
          time: 'Just now',
          type: 'settle'
        }
      });
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// BUDGETS API
// ----------------------------------------------------
app.get('/api/budgets', authenticateToken, async (req, res) => {
  try {
    // Get budgets for the groups the user is in
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user.id },
      select: { groupId: true }
    });
    const groupIds = memberships.map(m => m.groupId);

    const budgets = await prisma.budget.findMany({
      where: { groupId: { in: groupIds } }
    });

    res.json(budgets.map(b => ({
      gid: b.groupId,
      limit_amount: b.limitAmount,
      threshold: b.threshold
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/budgets', authenticateToken, async (req, res) => {
  try {
    const { gid, limit, threshold } = req.body;
    const limitVal = parseInt(limit);

    if (!gid || isNaN(limitVal)) {
      return res.status(400).json({ error: 'Group ID and limit are required' });
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.budget.findUnique({ where: { groupId: gid } });
      if (existing) {
        await tx.budget.update({
          where: { groupId: gid },
          data: { limitAmount: limitVal, threshold: threshold || '80%' }
        });
      } else {
        await tx.budget.create({
          data: { groupId: gid, limitAmount: limitVal, threshold: threshold || '80%' }
        });
      }

      // Sync budget on group object
      await tx.group.update({
        where: { id: gid },
        data: { budget: limitVal }
      });
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// NOTIFICATIONS API
// ----------------------------------------------------
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifs = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json(notifs.map(n => ({
      id: n.id,
      title: n.title,
      body: n.body,
      time: n.time,
      read: n.read,
      type: n.type
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/read', authenticateToken, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id },
      data: { read: true }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// AI INSIGHTS
// ----------------------------------------------------
app.get('/api/ai-insights', authenticateToken, async (req, res) => {
  try {
    const { net } = await calculateNetBalances(req.user.id);
    
    // Get user's expenses
    const userSplits = await prisma.expenseSplit.findMany({
      where: { userId: req.user.id },
      include: { expense: true }
    });

    if (userSplits.length === 0) {
      return res.json([
        { ico: '🚀', txt: 'Welcome! Create a group and add your first expense to see custom financial insights.' }
      ]);
    }

    // Spend by category
    const categoryMap = {};
    let totalSpend = 0;
    userSplits.forEach(s => {
      categoryMap[s.expense.cat] = (categoryMap[s.expense.cat] || 0) + s.shareAmount;
      totalSpend += s.shareAmount;
    });

    const topCategoryEntry = Object.entries(categoryMap).sort((a, b) => b[1] - a[1])[0];
    const topCategory = topCategoryEntry ? topCategoryEntry[0] : 'None';
    const topCategorySpend = topCategoryEntry ? topCategoryEntry[1] : 0;

    // Food share total
    const foodShareTotal = categoryMap['food'] || 0;

    const userBalance = net[req.user.id] || 0;
    const optimizedDebts = minCashFlow(net);
    const oweCount = optimizedDebts.filter(d => d.from === req.user.id).length;
    const owedCount = optimizedDebts.filter(d => d.to === req.user.id).length;

    const insights = [];

    if (foodShareTotal > 0) {
      insights.push({
        ico: '🍔',
        txt: `You spent ₹${Math.round(foodShareTotal).toLocaleString('en-IN')} on food — keep it under ₹${Math.round(foodShareTotal * 0.8).toLocaleString('en-IN')} next month to save 20%.`
      });
    }

    if (topCategory && topCategory !== 'food') {
      insights.push({
        ico: '🎯',
        txt: `Your highest expense category is ${topCategory.toUpperCase()} (₹${Math.round(topCategorySpend).toLocaleString('en-IN')}). Consider establishing a category budget.`
      });
    }

    insights.push({
      ico: '💡',
      txt: userBalance >= 0
        ? `Great news! You are owed a net of ₹${Math.round(userBalance).toLocaleString('en-IN')} across your groups. ${owedCount} friend(s) owe you.`
        : `You owe a net of ₹${Math.round(-userBalance).toLocaleString('en-IN')} overall. ${oweCount} payment(s) will clear your balance.`
    });

    if (totalSpend > 5000) {
      insights.push({
        ico: '📈',
        txt: `Total amount tracked under your share: ₹${Math.round(totalSpend).toLocaleString('en-IN')}. Good job monitoring your finances!`
      });
    }

    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Wildcard fallback serving the frontend files
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
