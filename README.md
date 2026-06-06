# SettleFlow 💸

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-blue.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/database-SQLite%20%2F%20Prisma-orange.svg)](https://www.prisma.io/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**SettleFlow** is a premium, full-stack multi-user expense sharing platform. It simplifies shared bills, tracks group budgets, and uses a greedy optimization algorithm to resolve debt networks efficiently.

---

## ✨ Features

- 🔒 **Secure JWT Authentication**: Real-world user sign-up, sign-in, and route protection.
- ⚡ **Greedy Debt Simplification**: Built-in cash flow routing (`minCashFlow` algorithm) to minimize the number of transactional settlements between users.
- 🎨 **Premium UI**: Modern light/dark mode glassmorphic interface built using native, responsive CSS and a custom focus-safe rendering engine.
- 📊 **Smart Budgets & AI Insights**: Group budget threshold warnings (80%/100%) and dynamic AI spending suggestions based on real user transaction history.
- 💾 **Relational Persistence**: Powered by Prisma 6 ORM with a localized SQLite database backend.

---

## 🛠️ Tech Stack

- **Frontend**: HTML5, Vanilla CSS (Custom tokens), Vanilla JS (State-driven SPA)
- **Backend**: Express.js, JSON Web Tokens (JWT), bcryptjs
- **Database Layer**: Prisma v6.2.0 ORM, SQLite

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/SettleFlow.git
   cd SettleFlow
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create a `.env` file in the root directory:
   ```env
   DATABASE_URL="file:./dev.db"
   JWT_SECRET="your-super-secure-jwt-secret-key"
   PORT=8000
   ```

4. **Initialize the database (Prisma Migration):**
   ```bash
   npx prisma migrate dev --name init
   ```

5. **Start the local server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:8000` in your browser.

---

## 🤝 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
