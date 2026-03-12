# Utiliser une image Node.js
FROM node:20-alpine

# Installer les outils nécessaires pour compiler les modules natifs
RUN apk add --no-cache python3 make g++

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer toutes les dépendances
RUN npm install --include=dev

# Copier tout le reste du code
COPY . .

# Construire l'application en mode très détaillé pour voir l'erreur
RUN npm run build -- --verbose

# Supprimer les outils de compilation pour alléger l'image
RUN apk del python3 make g++

# Exposer le port 3000
EXPOSE 3000

# Lancer l'application
CMD ["npm", "start"]
