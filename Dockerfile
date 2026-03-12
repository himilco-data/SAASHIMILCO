# Utiliser une image Node.js (Debian)
FROM node:20

# Installer les outils nécessaires pour compiler les modules natifs
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances et afficher le log complet en cas d'erreur
RUN npm install --include=dev || (cat /root/.npm/_logs/*-debug.log && exit 1)

# Copier tout le reste du code
COPY . .

# Construire l'application
RUN npm run build

# Exposer le port 3000
EXPOSE 3000

# Lancer l'application
CMD ["npm", "start"]
