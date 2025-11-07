const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateUser, authenticateAdmin } = require('../middleware/auth');
const { supabase } = require('../config/supabase');
const router = express.Router();

// Definir bucket de storage (crie no Supabase e deixe como público)
const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || 'uploads';

// Configurar multer para upload em memória (compatível com Vercel)
const storage = multer.memoryStorage();

// Filtro para aceitar apenas imagens
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não permitido. Apenas JPG, JPEG, PNG, GIF e WEBP são aceitos.'), false);
  }
};

// Configurar multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Em desenvolvimento local, servir arquivos estáticos do diretório uploads (fallback)
if (process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'production') {
  router.use('/files', express.static(path.join(__dirname, '../uploads')));
}

// Helper: gerar nome único e caminho para storage
function generateStoragePath(originalName, prefix) {
  const extension = path.extname(originalName) || '';
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const safePrefix = prefix ? `${prefix.replace(/[^a-zA-Z0-9/_-]/g, '')}/` : '';
  return `${safePrefix}${uniqueSuffix}${extension}`;
}

// Helper: fazer upload para Supabase Storage
async function uploadToSupabaseStorage(fileBuffer, contentType, originalName, prefix) {
  const storagePath = generateStoragePath(originalName, prefix);
  const { data, error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true
    });

  if (error) {
    throw new Error(`Falha ao enviar para storage: ${error.message}`);
  }

  const { data: publicData } = supabase.storage
    .from(UPLOAD_BUCKET)
    .getPublicUrl(storagePath);

  const publicUrl = publicData?.publicUrl || null;
  return { storagePath, publicUrl };
}

// Upload de foto de político
router.post('/politician-photo', authenticateUser, authenticateAdmin, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
    }

    const { buffer, mimetype, originalname, size } = req.file;
    const { storagePath, publicUrl } = await uploadToSupabaseStorage(buffer, mimetype, originalname, 'politicians');

    res.json({
      success: true,
      message: 'Foto do político enviada com sucesso',
      data: {
        filename: path.basename(storagePath),
        originalName: originalname,
        size,
        url: publicUrl
      }
    });
  } catch (error) {
    console.error('Erro no upload da foto do político:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

// Upload de imagem de produto
router.post('/product-image', authenticateUser, authenticateAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
    }

    const { buffer, mimetype, originalname, size } = req.file;
    const { storagePath, publicUrl } = await uploadToSupabaseStorage(buffer, mimetype, originalname, 'products');

    res.json({
      success: true,
      message: 'Imagem do produto enviada com sucesso',
      data: {
        filename: path.basename(storagePath),
        originalName: originalname,
        size,
        url: publicUrl
      }
    });
  } catch (error) {
    console.error('Erro no upload da imagem do produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

// Upload genérico de imagem (blog)
router.post('/image', authenticateUser, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
    }

    const { buffer, mimetype, originalname, size } = req.file;
    const { storagePath, publicUrl } = await uploadToSupabaseStorage(buffer, mimetype, originalname, 'blog');

    res.json({
      success: true,
      message: 'Imagem enviada com sucesso',
      data: {
        filename: path.basename(storagePath),
        originalName: originalname,
        size,
        url: publicUrl
      }
    });
  } catch (error) {
    console.error('Erro no upload da imagem:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

// Deletar arquivo do Supabase Storage
router.delete('/files/:filename', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { filename } = req.params;
    if (!filename) return res.status(400).json({ error: 'Filename é obrigatório' });

    const { data, error } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .remove([filename]);

    if (error) {
      return res.status(500).json({ error: 'Erro ao deletar arquivo no storage', message: error.message });
    }

    res.json({ success: true, message: 'Arquivo deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar arquivo:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

// Middleware de tratamento de erros do multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Arquivo muito grande. Tamanho máximo: 5MB' });
    }
    return res.status(400).json({ error: error.message });
  }
  
  if (error.message && error.message.includes('Tipo de arquivo não permitido')) {
    return res.status(400).json({ error: error.message });
  }
  
  next(error);
});

module.exports = router;