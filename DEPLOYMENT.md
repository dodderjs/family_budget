# Deployment Guide

## Quick Start Commands

### Development
```bash
cd /mnt/f/wwwLinux/family_budget
cp .env.example .env
docker-compose up --build
```

### Production Deployment
```bash
# Build images once
docker-compose build

# Run services
docker-compose up -d  # Run in background

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

---

## Service URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://localhost:5173 | User interface |
| Backend API | http://localhost:8000 | REST API |
| API Docs | http://localhost:8000/docs | Swagger documentation |
| Health Check | http://localhost:8000/health | Service status |
| Database | localhost:3306 | MariaDB |

---

## Database Backup & Restore

### Backup
```bash
docker-compose exec mariadb mysqldump -u budget_user -p family_budget > backup.sql
```

### Restore
```bash
docker-compose exec mariadb mysql -u budget_user -p family_budget < backup.sql
```

---

## Troubleshooting

### Services Won't Start
```bash
# Check logs
docker-compose logs backend
docker-compose logs frontend
docker-compose logs mariadb

# Rebuild images
docker-compose build --no-cache

# Reset everything
docker-compose down -v
docker-compose up --build
```

### Database Connection Issues
```bash
# Test connection
docker-compose exec mariadb mysql -u budget_user -p -e "SELECT 1"

# Check credentials in .env
cat .env | grep MYSQL
```

### Port Conflicts
```bash
# Check what's using ports
lsof -i :5173  # Frontend
lsof -i :8000  # Backend
lsof -i :3306  # Database

# Change ports in docker-compose.yml if needed
```

---

## Environment Variables

Edit `.env` file to customize:

```env
# Database
MYSQL_ROOT_PASSWORD=change_me
MYSQL_PASSWORD=change_me

# Services can communicate using service names
DATABASE_URL=mysql+pymysql://budget_user:budget_password@mariadb:3306/family_budget

# Debug mode
DEBUG=1
PYTHONUNBUFFERED=1

# Frontend API endpoint
VITE_API_URL=http://localhost:8000/api/v1
```

---

## Monitoring

### Check System Health
```bash
# All services running?
docker-compose ps

# CPU and memory usage
docker stats

# Network connectivity
docker network ls
docker network inspect family_budget_budget-network
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f mariadb

# Last 100 lines
docker-compose logs --tail=100
```

---

## Performance Tuning

### Backend
- Adjust workers in uvicorn command
- Enable database connection pooling
- Cache ML model in memory (already done)

### Database
- Add indexes for frequently queried columns
- Configure innodb_buffer_pool_size in docker-compose.yml

### Frontend
- Enable Vite production build
- Minify and compress assets

---

## Security Recommendations

1. **Change default passwords** in .env
2. **Use environment secrets** for production
3. **Enable CORS restrictions** by specific origin
4. **Add authentication** (JWT or similar)
5. **Use HTTPS** in production
6. **Keep dependencies updated** regularly
7. **Implement rate limiting** on API
8. **Add input validation** for all user inputs

---

## Scaling Strategies

### Horizontal Scaling
```yaml
# Run multiple backend instances
backend-1:
  # Config...

backend-2:
  # Config...

# Use load balancer (nginx/haproxy)
```

### Database Scaling
- Read replicas for analytics queries
- Connection pooling (PgBouncer/ProxySQL)
- Partitioning large tables

### Frontend Caching
- CDN for static assets
- Browser caching headers
- Service worker for offline capability

---

## Maintenance Tasks

### Regular Updates
```bash
# Update Docker images
docker-compose pull

# Rebuild
docker-compose build --pull

# Restart
docker-compose restart
```

### Database Maintenance
```bash
# Optimize tables
docker-compose exec mariadb mysql -u budget_user -p -e "OPTIMIZE TABLE transactions"

# Check integrity
docker-compose exec mariadb mysqlcheck -u budget_user -p family_budget
```

### Logs Rotation
```bash
# Limit log file size in docker-compose.yml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

---

## Backup Strategy

### Automated Backup
```bash
# Create backup script (backup.sh)
#!/bin/bash
docker-compose exec mariadb mysqldump -u budget_user -p family_budget | \
  gzip > backup_$(date +%Y%m%d).sql.gz
```

Schedule with cron:
```bash
# Daily at 2 AM
0 2 * * * /path/to/backup.sh
```

---

## Disaster Recovery

### Full System Restore
```bash
# 1. Stop services
docker-compose down -v

# 2. Restore backup
docker-compose up -d mariadb
docker-compose exec mariadb mysql -u budget_user -p family_budget < backup.sql

# 3. Start other services
docker-compose up -d
```

---

## Version Management

Track versions in `.env`:
```env
BACKEND_VERSION=1.0.0
FRONTEND_VERSION=1.0.0
DATABASE_VERSION=11
```

Use git tags:
```bash
git tag -a v1.0.0 -m "Production release"
git push origin v1.0.0
```

---

## Continuous Integration

### Example GitHub Actions
```yaml
name: Build and Deploy

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Build Docker images
        run: docker-compose build
      - name: Run tests
        run: docker-compose run backend pytest
      - name: Push to registry
        run: docker-compose push
```

---

## Support & Documentation

- **API**: /docs
- **GitHub**: [repository-url]
- **Issues**: [issues-url]
- **Discussions**: [discussions-url]

---

Last Updated: May 2024
Version: 1.0.0
