# RaidLocal

A **local web interface** for running [SimulationCraft](https://github.com/simulationcraft/simc) simulations. Run WoW character simulations locally without relying on external services like Raidbots.

## 🎯 What is RaidLocal?

RaidLocal is a self-hosted web application that provides a user-friendly interface for SimulationCraft. It allows you to:

- **Run quick simulations** by pasting SimC code
- **Compare gear combinations** using profilesets for top-gear analysis
- **Process simulations asynchronously** with a job queue system
- **View results** in both JSON format and HTML reports
- **Keep your data private** by running everything locally

## 🏗️ Architecture

- **Backend**: FastAPI (Python) with Redis job queue
- **Frontend**: Vanilla HTML/JavaScript with modern CSS
- **Simulation Engine**: SimulationCraft CLI compiled from source
- **Containerization**: Docker with multi-stage builds
- **Job Processing**: Redis + RQ for background simulation processing

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose installed
- At least 4GB RAM available for building SimulationCraft

### 1. Clone and Navigate

```bash
git clone <your-repo-url>
cd raidlocal
```

### 2. Build and Run

```bash
# Build the containers (this may take 10-15 minutes on first run)
docker-compose build --no-cache

# Start the application
docker-compose up
```

### 3. Access the Application

Open your browser and go to: **http://localhost:8000**

## 📖 How to Use

### Quick Simulation

1. **Paste SimC Code**: Copy your character's SimC export from the WoW addon or paste a .simc file content
2. **Set Iterations**: Choose how many simulation iterations to run (default: 10,000)
3. **Add Extra Args**: Optional parameters like `threads=8` or `fight_style=HecticAddCleave`
4. **Click "Run Quick Sim"**: The simulation will be queued and processed

### Top Gear Analysis

1. **Base Profile**: Paste your base character profile
2. **Profilesets**: Define gear combinations in JSON format:
   ```json
   [
     {
       "name": "trinketA",
       "overrides": ["trinket1=id:12345"]
     },
     {
       "name": "trinketB", 
       "overrides": ["trinket1=id:67890"]
     }
   ]
   ```
3. **Run Profilesets**: Compare all combinations in a single simulation

### Understanding Results

- **DPS**: Average damage per second across all iterations
- **DPS Error**: Statistical margin of error for the DPS value
- **Iterations**: Number of successful simulation runs
- **Duration**: How long the simulation took to complete
- **HTML Report**: Click the link to view detailed SimulationCraft HTML output

## 🔧 Configuration

### Environment Variables

- `REDIS_URL`: Redis connection string (default: `redis://redis:6379/0`)
- `SIMC_BIN`: Path to SimulationCraft binary (default: `/usr/local/bin/simc`)

### Docker Compose Services

- **web**: FastAPI application server (port 8000)
- **worker**: Background job processor for simulations
- **redis**: Job queue and caching backend (port 6379)

## 🐛 Troubleshooting

### Common Issues

1. **Build Fails**: Ensure you have at least 4GB RAM available
2. **Simulation Errors**: Check your SimC code syntax and ensure it's valid
3. **Port Conflicts**: Change ports in `docker-compose.yml` if 8000 is already in use

### Debug Mode

```bash
# View logs
docker-compose logs -f

# Access container shell
docker-compose exec web bash

# Check SimulationCraft installation
docker-compose exec web simc --version
```

## 📁 Project Structure

```
raidlocal/
├── backend/                 # Python FastAPI backend
│   ├── app.py             # Main application and API endpoints
│   ├── simc_runner.py     # SimulationCraft execution wrapper
│   ├── queue_utils.py     # Redis job queue management
│   └── requirements.txt   # Python dependencies
├── frontend/               # Web interface
│   ├── index.html         # Main HTML page
│   ├── styles.css         # Styling and layout
│   └── app.js            # Frontend logic and API calls
├── Dockerfile              # Multi-stage container build
├── docker-compose.yml      # Service orchestration
├── LICENSE                 # Creative Commons BY-NC 4.0 License
└── README.md              # This file
```

## 🔒 Security Considerations

- **Local Only**: Application runs entirely on your machine
- **No External Calls**: Simulations don't require internet access
- **Input Validation**: SimC input is validated before execution
- **Resource Limits**: Built-in timeouts prevent runaway simulations

## 🚀 Performance Tips

- **Iterations**: Use 5,000-10,000 iterations for quick testing, 25,000+ for final results
- **Threads**: Set `threads=8` (or your CPU core count) in extra args
- **Fight Style**: Choose appropriate fight style for your use case
- **Profilesets**: Group related gear comparisons to run in parallel

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with Docker build
5. Submit a pull request

## 📄 License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International License** (CC BY-NC 4.0).

**What this means:**
- ✅ **You can**: Copy, modify, and distribute this code for personal and educational use
- ✅ **You can**: Share and adapt the code with proper attribution
- ❌ **You cannot**: Use this code for commercial purposes (selling, monetizing, etc.)
- 📝 **You must**: Give appropriate credit and link to the license

For full license details, see the [LICENSE](LICENSE) file or visit [https://creativecommons.org/licenses/by-nc/4.0/](https://creativecommons.org/licenses/by-nc/4.0/)

## 🙏 Acknowledgments

- **SimulationCraft Team**: For the amazing simulation engine
- **FastAPI**: For the modern Python web framework
- **Redis + RQ**: For reliable job queue processing

## 📞 Support

- **Issues**: Create GitHub issues for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions and help
- **Documentation**: Check the SimulationCraft wiki for SimC syntax help

---

**Happy Simming!** 🎮⚔️
