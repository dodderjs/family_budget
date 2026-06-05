#!/bin/bash

# Family Budget - Quick Start Script

set -e

echo "🚀 Family Budget - Quick Start"
echo "================================"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create .env if not exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ Created .env"
fi

# Show important info
echo ""
echo "📋 Configuration:"
echo "  - Frontend: http://localhost:5173"
echo "  - Backend: http://localhost:8000"
echo "  - API Docs: http://localhost:8000/docs"
echo "  - Database: localhost:3306"
echo ""

# Ask user what to do
echo "What would you like to do?"
echo "1. Build and start all services"
echo "2. Start (assume images are built)"
echo "3. Stop services"
echo "4. View logs"
echo "5. Connect to database"
echo ""

read -p "Choose option (1-5): " choice

case $choice in
    1)
        echo "🔨 Building and starting services..."
        docker-compose up --build
        ;;
    2)
        echo "▶️  Starting services..."
        docker-compose up
        ;;
    3)
        echo "⏹️  Stopping services..."
        docker-compose down
        echo "✅ Services stopped"
        ;;
    4)
        echo "📋 Viewing logs..."
        docker-compose logs -f
        ;;
    5)
        echo "🗄️  Connecting to database..."
        docker-compose exec mariadb mysql -u budget_user -p family_budget
        ;;
    *)
        echo "❌ Invalid option"
        exit 1
        ;;
esac
