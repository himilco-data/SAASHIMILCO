# Utiliser une image Node.js
FROM node:20-alpine

# Installer les outils nécessaires pour compiler les modules natifs (comme better-sqlite3)
RUN apk add --no-cache python3 make g++

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer toutes les dépendances (incluant les devDependencies pour la compilation)
RUN npm install --include=dev

# Copier tout le reste du code
COPY . .

# Construire l'application
RUN npm run build

# Supprimer les outils de compilation pour alléger l'image
RUN apk del python3 make g++

# Exposer le port 3000
EXPOSE 3000

# Lancer l'application
CMD ["npm", "start"]
