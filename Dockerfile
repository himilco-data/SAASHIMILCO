# Utiliser une image Node.js basée sur Debian (plus robuste pour la compilation)
FROM node:20

# Installer les outils de compilation essentiels
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances (sans --include=dev pour éviter de compiler des outils inutiles)
RUN npm install

# Copier tout le reste du code
COPY . .

# Construire l'application
RUN npm run build

# Exposer le port 3000
EXPOSE 3000

# Lancer l'application
CMD ["npm", "start"]
